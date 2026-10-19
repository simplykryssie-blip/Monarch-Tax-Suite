import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { unwrap } from "../commerce/supabase-repo.ts";
import type { OfficeEvent, OfficeMember, OfficeRepo } from "./service.ts";

/** Office tables, on a tenant-scoped client: row-level security limits every call to that tenant's rows. */
export class SupabaseOfficeRepo implements OfficeRepo {
  constructor(private db: SupabaseClient) {}

  async listOffices() {
    const rows = unwrap(await this.db.from("organizations").select("id, legal_name, dba_name, kind, archived_at").neq("kind", "bureau").order("legal_name")) as { id: string; legal_name: string; dba_name: string | null; archived_at: string | null }[];
    return rows.map((r) => ({ id: r.id, name: r.dba_name || r.legal_name, archived: !!r.archived_at }));
  }
  async listMembers(officeId?: string) {
    let q = this.db.from("office_members").select("*").order("role").order("full_name");
    if (officeId) q = q.eq("organization_id", officeId);
    return unwrap(await q) as OfficeMember[];
  }
  async getMember(id: string) {
    return unwrap(await this.db.from("office_members").select("*").eq("id", id).maybeSingle()) as OfficeMember | null;
  }
  async insertMember(input: Parameters<OfficeRepo["insertMember"]>[0]) {
    return unwrap(await this.db.from("office_members").insert(input).select("*").single()) as OfficeMember;
  }
  async updateMember(id: string, patch: Partial<OfficeMember>) {
    return unwrap(await this.db.from("office_members").update(patch).eq("id", id).select("*").single()) as OfficeMember;
  }
  async addEvent(input: Omit<OfficeEvent, "id" | "created_at">) {
    unwrap(await this.db.from("office_events").insert(input));
  }
  async listEvents(officeId: string, limit = 100) {
    return unwrap(await this.db.from("office_events").select("*").eq("organization_id", officeId).order("created_at", { ascending: false }).limit(limit)) as OfficeEvent[];
  }
}
