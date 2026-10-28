import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { unwrap } from "../commerce/supabase-repo.ts";
import type { LabKey, LabMember, LabRepo, LabScenario, LabTerms, LabWork, NewMember, ScenarioInput } from "./types.ts";

// The Tax Lab tables (migration 20261203090000_tax_lab). Every call goes through a tenant client, so row-level
// security keeps it inside the Monarch tenant. Only server code reaches these tables; browsers have no grants.

export class SupabaseLabRepo implements LabRepo {
  constructor(private db: SupabaseClient) {}

  private async one<T>(table: string, column: string, value: string): Promise<T | null> {
    return unwrap(await this.db.from(table).select("*").eq(column, value).maybeSingle()) as T | null;
  }

  getTerms(licenseId: string) { return this.one<LabTerms>("lab_license_terms", "license_id", licenseId); }
  async createTerms(terms: LabTerms) {
    return unwrap(await this.db.from("lab_license_terms").insert(terms).select("*").single()) as LabTerms;
  }

  async membersForUser(userId: string) {
    return unwrap(await this.db.from("lab_members").select("*").eq("user_id", userId)) as LabMember[];
  }
  async membersOfLicense(licenseId: string) {
    return unwrap(await this.db.from("lab_members").select("*").eq("license_id", licenseId).order("created_at")) as LabMember[];
  }
  getMember(id: string) { return this.one<LabMember>("lab_members", "id", id); }
  memberByInviteHash(hash: string) { return this.one<LabMember>("lab_members", "invite_token_hash", hash); }
  async createMember(member: NewMember) {
    return unwrap(await this.db.from("lab_members").insert(member).select("*").single()) as LabMember;
  }
  async updateMember(id: string, patch: Partial<LabMember>) {
    const { id: _id, created_at: _c, ...rest } = patch;
    void _id; void _c;
    return unwrap(await this.db.from("lab_members").update({ ...rest, updated_at: new Date().toISOString() }).eq("id", id).select("*").single()) as LabMember;
  }

  async listScenarios(licenseIds: string[]) {
    let q = this.db.from("lab_scenarios").select("*");
    const ids = licenseIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    q = ids.length ? q.or(`license_id.is.null,license_id.in.(${ids.join(",")})`) : q.is("license_id", null);
    return unwrap(await q.order("updated_at", { ascending: false }).limit(500)) as LabScenario[];
  }
  getScenario(id: string) { return this.one<LabScenario>("lab_scenarios", "id", id); }
  async saveScenario(s: ScenarioInput) {
    const row = { ...s, updated_at: new Date().toISOString() };
    return unwrap(await this.db.from("lab_scenarios").upsert(row, { onConflict: "id" }).select("*").single()) as LabScenario;
  }
  async deleteScenario(id: string) {
    unwrap(await this.db.from("lab_scenarios").delete().eq("id", id));
  }

  getKey(scenarioId: string) { return this.one<LabKey>("lab_answer_keys", "scenario_id", scenarioId); }
  async saveKey(key: LabKey) {
    return unwrap(await this.db.from("lab_answer_keys").upsert({ ...key, updated_at: new Date().toISOString() }, { onConflict: "scenario_id" }).select("*").single()) as LabKey;
  }

  async getWork(memberId: string, scenarioId: string) {
    return unwrap(await this.db.from("lab_work").select("*").eq("member_id", memberId).eq("scenario_id", scenarioId).maybeSingle()) as LabWork | null;
  }
  getWorkById(id: string) { return this.one<LabWork>("lab_work", "id", id); }
  async workForMembers(memberIds: string[]) {
    if (!memberIds.length) return [];
    return unwrap(await this.db.from("lab_work").select("*").in("member_id", memberIds).limit(2000)) as LabWork[];
  }
  async saveWork(work: Partial<LabWork> & { member_id: string; scenario_id: string }) {
    const { id: _id, created_at: _c, ...rest } = work;
    void _id; void _c;
    const row = { ...rest, updated_at: new Date().toISOString() };
    return unwrap(await this.db.from("lab_work").upsert(row, { onConflict: "member_id,scenario_id" }).select("*").single()) as LabWork;
  }
}
