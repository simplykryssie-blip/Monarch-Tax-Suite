import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { unwrap } from "../commerce/supabase-repo.ts";
import type { PortalAudit, PortalMember, PortalMemberRepo } from "./service.ts";

/** Portal sign-in rows, on a tenant-scoped client: row-level security limits every call to that tenant's rows. */
export class SupabasePortalMemberRepo implements PortalMemberRepo {
  constructor(private db: SupabaseClient) {}
  async getForClient(clientId: string) {
    return unwrap(await this.db.from("portal_members").select("*").eq("client_id", clientId).maybeSingle()) as PortalMember | null;
  }
  async get(id: string) {
    return unwrap(await this.db.from("portal_members").select("*").eq("id", id).maybeSingle()) as PortalMember | null;
  }
  async insert(input: Parameters<PortalMemberRepo["insert"]>[0]) {
    return unwrap(await this.db.from("portal_members").insert(input).select("*").single()) as PortalMember;
  }
  async update(id: string, patch: Parameters<PortalMemberRepo["update"]>[1]) {
    return unwrap(await this.db.from("portal_members").update(patch).eq("id", id).select("*").single()) as PortalMember;
  }
  async addAudit(input: PortalAudit) {
    unwrap(await this.db.from("workspace_audit_events").insert({ actor_id: input.actor_id, action: input.action, subject_type: input.subject_type ?? null, subject_id: input.subject_id ?? null, detail: input.detail ?? {} }));
  }
}
