import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ValidationError } from "./commerce/validation.ts";
import { tenantClient } from "./supabase/service";
import { currentTenantId } from "./tenants.ts";
import { SupabaseAutomationRepo } from "./automation/supabase-repo.ts";
import { documentDeps } from "./documents/server";
import { removeDocument } from "./documents/service.ts";
import { formDeps } from "./forms/server";
import { removeForm } from "./forms/service.ts";
import { readSettings } from "./forms/settings.ts";
import { staleThemeImages } from "./forms/theme-images.ts";
import { SupabaseCommerceRepo, SupabaseImageStore } from "./commerce/supabase-repo.ts";
import { ENTITY, type ArchiveEntity, type ArchiveFacts, type ArchiveLogEntry, type ArchiveLogRow, type ArchiveRow } from "./archive.ts";
import type { ArchiveStore } from "./archive-service.ts";

// The archive store for the signed-in tenant. Every query runs as that tenant, so the database's tenant policies
// decide what can be seen, archived, restored or deleted.

const rows = <T>(r: { data: unknown; error: { message: string } | null }): T[] => {
  if (r.error) throw new Error(r.error.message);
  return (r.data ?? []) as T[];
};

/** "still referenced from table "orders"" -> a plain reason the record is kept. */
function keptBecause(entity: ArchiveEntity, message: string): string {
  const table = /referenced from table "?([a-z_]+)"?/.exec(message)?.[1];
  const what: Record<string, string> = {
    orders: "orders", calculator_licenses: "licenses", calculator_installations: "installations", service_orders: "service orders",
    document_deliveries: "sent copies", form_submissions: "submissions", automation_executions: "workflow history", organizations: "a firm",
  };
  return `This ${ENTITY[entity].noun} still has linked ${table ? what[table] ?? "records" : "records"}, which are kept. It stays archived.`;
}

export class SupabaseArchiveStore implements ArchiveStore {
  constructor(private db: SupabaseClient, private tenantId: string) {}

  async get(entity: ArchiveEntity, id: string) {
    const r = await this.db.from(ENTITY[entity].table).select("*").eq("id", id).maybeSingle();
    if (r.error) throw new Error(r.error.message);
    return (r.data as ArchiveRow | null) ?? null;
  }

  async facts(entity: ArchiveEntity, row: ArchiveRow): Promise<ArchiveFacts> {
    if (entity === "customer") {
      const [licenses, serviceOrders, orders] = await Promise.all([
        this.db.from("calculator_licenses").select("status, archived_at").eq("customer_id", row.id).then(rows<{ status: string; archived_at: string | null }>),
        this.db.from("service_orders").select("status").eq("customer_id", row.id).then(rows<{ status: string }>),
        this.db.from("orders").select("amount_cents, payment_status, paid_at").eq("customer_id", row.id).then(rows<{ amount_cents: number; payment_status: string; paid_at: string | null }>),
      ]);
      return { licenses, serviceOrders, orders };
    }
    if (entity === "order") {
      const [licenses, serviceOrders] = await Promise.all([
        this.db.from("calculator_licenses").select("status, archived_at").eq("order_id", row.id).then(rows<{ status: string; archived_at: string | null }>),
        this.db.from("service_orders").select("status").eq("order_id", row.id).then(rows<{ status: string }>),
      ]);
      return { licenses, serviceOrders };
    }
    if (entity === "service_order" && typeof row.order_id === "string") {
      const o = await this.db.from("orders").select("order_number").eq("id", row.order_id).maybeSingle();
      return { orderNumber: (o.data?.order_number as number | undefined) ?? null };
    }
    return {};
  }

  async update(entity: ArchiveEntity, id: string, patch: Record<string, unknown>) {
    const r = await this.db.from(ENTITY[entity].table).update(patch).eq("id", id).select("id");
    if (rows(r).length !== 1) throw new ValidationError(`That ${ENTITY[entity].noun} was not found.`);
  }

  async remove(entity: ArchiveEntity, row: ArchiveRow) {
    // Records with their own clean-up (files, drafts) go through their module, which keeps anything with history.
    if (entity === "document") {
      const deps = documentDeps(this.tenantId);
      if ((await deps.repo.countDeliveries(row.id)) > 0) throw new ValidationError("This document was sent to people, and those copies are kept. It stays archived.");
      await removeDocument(deps, row.id, "owner");
      return;
    }
    if (entity === "form") {
      const deps = formDeps(this.tenantId);
      if ((await deps.repo.countSubmitted(row.id)) > 0) throw new ValidationError("This form has submissions, and those are kept. It stays archived.");
      const forms = await deps.repo.listForms();
      const theme = readSettings(forms.find((f) => f.id === row.id)?.settings).theme;
      if ((await removeForm(deps, row.id, "owner")) === "deleted") {
        const others = forms.filter((f) => f.id !== row.id).map((f) => readSettings(f.settings).theme);
        await this.images().remove(staleThemeImages(this.tenantId, row.id, theme, null, others)).catch(() => undefined);
      }
      return;
    }
    if (entity === "workflow" && (await new SupabaseAutomationRepo(this.db).hasExecutions(row.id))) {
      throw new ValidationError("This workflow has run, and its history is kept. It stays archived.");
    }
    // A product's images are deleted with it (its rows go by cascade), so their files are removed from storage too.
    const images = entity === "product" ? await new SupabaseCommerceRepo(this.db).listProductImages([row.id]) : [];
    const r = await this.db.from(ENTITY[entity].table).delete().eq("id", row.id).select("id");
    if (r.error) {
      if (r.error.code === "23503" || /foreign key/i.test(r.error.message)) throw new ValidationError(keptBecause(entity, `${r.error.message} ${r.error.details ?? ""}`));
      throw new Error(r.error.message);
    }
    if (rows(r).length !== 1) throw new ValidationError(`That ${ENTITY[entity].noun} was not found.`);
    if (images.length) await this.images().remove(images.map((i) => i.storage_path)).catch(() => undefined);
  }

  private images() {
    return new SupabaseImageStore(this.db, this.tenantId);
  }

  async log(entry: ArchiveLogEntry) {
    const r = await this.db.from("archive_log").insert(entry);
    if (r.error) throw new Error(r.error.message);
  }

  async history(entity: ArchiveEntity, id: string) {
    return rows<ArchiveLogRow>(await this.db.from("archive_log").select("*").eq("entity", entity).eq("record_id", id).order("created_at", { ascending: false }).limit(50));
  }

  async recent(limit = 200) {
    return rows<ArchiveLogRow>(await this.db.from("archive_log").select("*").order("created_at", { ascending: false }).limit(limit));
  }

  /** Account owner of this tenant (tenant_members.role = 'owner'). */
  async isOwner(userId: string) {
    const r = await this.db.from("tenant_members").select("role").eq("user_id", userId).maybeSingle();
    if (r.error) return false;
    return r.data?.role === "owner";
  }
}

export const archiveStore = (tenantId: string = currentTenantId()) => new SupabaseArchiveStore(tenantClient(tenantId), tenantId);
