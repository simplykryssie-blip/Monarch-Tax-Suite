import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { unwrap } from "../commerce/supabase-repo.ts";
import type { AuditInput, PracticeMember, PracticePlatform, PracticeRepo } from "./service.ts";

/** Workspace tables, on a tenant-scoped client: row-level security limits every call to that tenant's rows. */
export class SupabasePracticeRepo implements PracticeRepo {
  constructor(private db: SupabaseClient) {}
  async listMembers() {
    return unwrap(await this.db.from("practice_members").select("*").order("created_at")) as PracticeMember[];
  }
  async getMember(id: string) {
    return unwrap(await this.db.from("practice_members").select("*").eq("id", id).maybeSingle()) as PracticeMember | null;
  }
  async insertMember(input: Parameters<PracticeRepo["insertMember"]>[0]) {
    return unwrap(await this.db.from("practice_members").insert(input).select("*").single()) as PracticeMember;
  }
  async updateMember(id: string, patch: Partial<PracticeMember>) {
    return unwrap(await this.db.from("practice_members").update(patch).eq("id", id).select("*").single()) as PracticeMember;
  }
  async addAudit(input: AuditInput) {
    unwrap(await this.db.from("workspace_audit_events").insert({ actor_id: input.actor_id, action: input.action, subject_type: input.subject_type ?? null, subject_id: input.subject_id ?? null, detail: input.detail ?? {} }));
  }
}

/** Platform-level writes (the tenants table and tenant_members carry no tenant of their own to act as). */
export class SupabasePracticePlatform implements PracticePlatform {
  constructor(private db: SupabaseClient) {}
  async createTenant(input: { slug: string; name: string; tier: "ptin" }) {
    return unwrap(await this.db.from("tenants").insert({ id: crypto.randomUUID(), ...input }).select("id").single()) as { id: string };
  }
  /** Every independent PTIN workspace and its owner's invite/account, for the platform administrator's list. */
  async listWorkspaces() {
    const tenants = unwrap(await this.db.from("tenants").select("id, name, created_at").eq("tier", "ptin").order("created_at", { ascending: false })) as { id: string; name: string; created_at: string }[];
    const members = tenants.length ? (unwrap(await this.db.from("practice_members").select("*").in("tenant_id", tenants.map((t) => t.id))) as (PracticeMember & { tenant_id: string })[]) : [];
    return tenants.map((t) => ({ ...t, member: members.find((m) => m.tenant_id === t.id) ?? null }));
  }
  async addTenantMember(tenantId: string, userId: string, role: "owner") {
    unwrap(await this.db.from("tenant_members").upsert({ tenant_id: tenantId, user_id: userId, role }, { onConflict: "tenant_id,user_id" }));
  }
}
