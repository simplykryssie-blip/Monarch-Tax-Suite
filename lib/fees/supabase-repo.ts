import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { unwrap } from "../commerce/supabase-repo.ts";
import type { Bank, BankImport, Charge, EventInput, FeeEvent, FeeLine, FeeSchedule, FeesRepo, LineInput, Mapping, MappingKind, Office, Receipt, ReceiptInput, ReturnFee, ReturnInput, TaxReturn } from "./types.ts";

/** Fee tables, on a tenant-scoped client: row-level security limits every call to that tenant's rows. */
export class SupabaseFeesRepo implements FeesRepo {
  constructor(private db: SupabaseClient) {}

  async listOffices(): Promise<Office[]> {
    const rows = unwrap(await this.db.from("organizations").select("id, legal_name, dba_name, kind, archived_at").neq("kind", "bureau").order("legal_name")) as { id: string; legal_name: string; dba_name: string | null; archived_at: string | null }[];
    return rows.map((r) => ({ id: r.id, name: r.dba_name || r.legal_name, archived: !!r.archived_at }));
  }
  async listBanks(): Promise<Bank[]> {
    const rows = unwrap(await this.db.from("bureau_options").select("id, name, active").eq("kind", "bank_product").order("sort_order").order("name")) as Bank[];
    return rows;
  }

  async getDefaultSchedule() {
    return unwrap(await this.db.from("fee_schedules").select("*").is("organization_id", null).maybeSingle()) as FeeSchedule | null;
  }
  async getOfficeSchedule(officeId: string) {
    return unwrap(await this.db.from("fee_schedules").select("*").eq("organization_id", officeId).maybeSingle()) as FeeSchedule | null;
  }
  async listOfficeSchedules() {
    return unwrap(await this.db.from("fee_schedules").select("*").not("organization_id", "is", null)) as FeeSchedule[];
  }
  async insertSchedule(input: { organization_id: string | null; name: string; created_by: string | null }) {
    return unwrap(await this.db.from("fee_schedules").insert({ ...input, updated_by: input.created_by }).select("*").single()) as FeeSchedule;
  }
  async deleteSchedule(id: string) {
    unwrap(await this.db.from("fee_schedules").delete().eq("id", id));
  }
  async listLines(scheduleIds: string[]) {
    if (!scheduleIds.length) return [];
    return unwrap(await this.db.from("fee_lines").select("*").in("schedule_id", scheduleIds).order("sort_order").order("label")) as FeeLine[];
  }
  async insertLine(scheduleId: string, input: LineInput) {
    return unwrap(await this.db.from("fee_lines").insert({ ...input, schedule_id: scheduleId }).select("*").single()) as FeeLine;
  }
  async updateLine(id: string, patch: Partial<LineInput>) {
    return unwrap(await this.db.from("fee_lines").update(patch).eq("id", id).select("*").single()) as FeeLine;
  }
  async deleteLine(id: string) {
    unwrap(await this.db.from("fee_lines").delete().eq("id", id));
  }

  async listReturns(filter: { officeId?: string; taxYear?: number; ids?: string[] }) {
    const out: TaxReturn[] = [];
    // Paged, so a busy season isn't cut off at the API's row limit.
    for (let from = 0; ; from += 1000) {
      let q = this.db.from("tax_returns").select("*").order("created_at").range(from, from + 999);
      if (filter.officeId) q = q.eq("organization_id", filter.officeId);
      if (filter.taxYear) q = q.eq("tax_year", filter.taxYear);
      if (filter.ids) q = q.in("id", filter.ids);
      const page = unwrap(await q) as TaxReturn[];
      out.push(...page);
      if (page.length < 1000) return out;
    }
  }
  async getReturn(id: string) {
    return unwrap(await this.db.from("tax_returns").select("*").eq("id", id).maybeSingle()) as TaxReturn | null;
  }
  async findReturnsByRef(ref: string, taxYear?: number) {
    let q = this.db.from("tax_returns").select("*").ilike("return_ref", ref.replace(/[\\%_]/g, (c) => `\\${c}`)).limit(10);
    if (taxYear) q = q.eq("tax_year", taxYear);
    return unwrap(await q) as TaxReturn[];
  }
  async insertReturn(input: ReturnInput & { created_by: string | null }) {
    return unwrap(await this.db.from("tax_returns").insert(input).select("*").single()) as TaxReturn;
  }
  async updateReturn(id: string, patch: Partial<ReturnInput> & { archived_at?: string | null; archived_by?: string | null; archive_reason?: string | null }) {
    return unwrap(await this.db.from("tax_returns").update(patch).eq("id", id).select("*").single()) as TaxReturn;
  }
  async listFees(returnIds: string[]) {
    const out: ReturnFee[] = [];
    for (let i = 0; i < returnIds.length; i += 300) {
      out.push(...(unwrap(await this.db.from("return_fees").select("*").in("return_id", returnIds.slice(i, i + 300)).order("sort_order").limit(5000)) as ReturnFee[]));
    }
    return out;
  }
  async replaceFees(returnId: string, charges: Charge[]) {
    unwrap(await this.db.from("return_fees").delete().eq("return_id", returnId));
    if (charges.length) unwrap(await this.db.from("return_fees").insert(charges.map((c) => ({ ...c, return_id: returnId }))));
  }

  async findImportByHash(sha256: string) {
    return unwrap(await this.db.from("bank_imports").select("*").eq("file_sha256", sha256).maybeSingle()) as BankImport | null;
  }
  async insertImport(input: Omit<BankImport, "id" | "created_at"> & { imported_by: string | null }) {
    return unwrap(await this.db.from("bank_imports").insert(input).select("*").single()) as BankImport;
  }
  async listImports() {
    return unwrap(await this.db.from("bank_imports").select("*").order("created_at", { ascending: false }).limit(100)) as BankImport[];
  }
  async listReceipts(filter: { returnIds?: string[]; unmatched?: boolean; importId?: string }) {
    if (filter.returnIds) {
      const out: Receipt[] = [];
      for (let i = 0; i < filter.returnIds.length; i += 300) {
        out.push(...(unwrap(await this.db.from("fee_receipts").select("*").in("return_id", filter.returnIds.slice(i, i + 300)).order("created_at").limit(5000)) as Receipt[]));
      }
      return out;
    }
    let q = this.db.from("fee_receipts").select("*").order("created_at", { ascending: false }).limit(1000);
    if (filter.unmatched) q = q.is("return_id", null);
    if (filter.importId) q = q.eq("import_id", filter.importId);
    return unwrap(await q) as Receipt[];
  }
  async insertReceipts(rows: (ReceiptInput & { created_by: string | null })[]) {
    const out: Receipt[] = [];
    for (let i = 0; i < rows.length; i += 500) out.push(...(unwrap(await this.db.from("fee_receipts").insert(rows.slice(i, i + 500)).select("*")) as Receipt[]));
    return out;
  }
  async linkReceipt(id: string, link: { return_id: string; organization_id: string }) {
    return unwrap(await this.db.from("fee_receipts").update(link).eq("id", id).is("return_id", null).select("*").single()) as Receipt;
  }
  async getReceipt(id: string) {
    return unwrap(await this.db.from("fee_receipts").select("*").eq("id", id).maybeSingle()) as Receipt | null;
  }

  async getMapping(kind: MappingKind) {
    const row = unwrap(await this.db.from("fee_csv_mappings").select("mapping").eq("kind", kind).maybeSingle()) as { mapping: Mapping } | null;
    return row?.mapping ?? null;
  }
  async saveMapping(kind: MappingKind, mapping: Mapping, actorId: string | null) {
    unwrap(await this.db.from("fee_csv_mappings").upsert({ kind, mapping, updated_by: actorId, updated_at: new Date().toISOString() }, { onConflict: "tenant_id,kind" }));
  }

  async addEvent(input: EventInput) {
    unwrap(await this.db.from("fee_events").insert(input));
  }
  async listEvents(filter: { entity?: FeeEvent["entity"]; recordId?: string; organizationId?: string; limit?: number }) {
    let q = this.db.from("fee_events").select("*").order("created_at", { ascending: false }).limit(filter.limit ?? 200);
    if (filter.entity) q = q.eq("entity", filter.entity);
    if (filter.recordId) q = q.eq("record_id", filter.recordId);
    if (filter.organizationId) q = q.eq("organization_id", filter.organizationId);
    return unwrap(await q) as FeeEvent[];
  }
}
