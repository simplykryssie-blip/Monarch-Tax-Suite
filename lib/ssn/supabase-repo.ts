import type { SupabaseClient } from "@supabase/supabase-js";
import type { KeyRow, SsnRepo } from "./service.ts";

const fail = (what: string, e: { message: string }) => new Error(`${what}: ${e.message}`);

export class SupabaseSsnRepo implements SsnRepo {
  constructor(private db: SupabaseClient, private tenantId: string) {}

  async clientExists(id: string) {
    const { data, error } = await this.db.from("clients").select("id").eq("id", id).maybeSingle();
    if (error) throw fail("client lookup failed", error);
    return !!data;
  }
  async getKey(): Promise<KeyRow | null> {
    const { data, error } = await this.db.from("tenant_data_keys").select("master_version, wrapped_key").eq("tenant_id", this.tenantId).maybeSingle();
    if (error) throw fail("key lookup failed", error);
    return (data as KeyRow | null) ?? null;
  }
  async insertKey(row: KeyRow) {
    const { error } = await this.db.from("tenant_data_keys").insert({ tenant_id: this.tenantId, ...row });
    if (!error) return true;
    if (error.code === "23505") return false;
    throw fail("key save failed", error);
  }
  async listKeys() {
    const { data, error } = await this.db.from("tenant_data_keys").select("tenant_id, master_version, wrapped_key");
    if (error) throw fail("key list failed", error);
    return (data ?? []) as (KeyRow & { tenant_id: string })[];
  }
  async saveWrappedKey(tenantId: string, row: KeyRow) {
    const { error } = await this.db.from("tenant_data_keys").update({ ...row, rotated_at: new Date().toISOString() }).eq("tenant_id", tenantId);
    if (error) throw fail("key re-wrap failed", error);
  }
  async getCiphertext(clientId: string) {
    const { data, error } = await this.db.from("client_ssn").select("ciphertext").eq("client_id", clientId).maybeSingle();
    if (error) throw fail("number lookup failed", error);
    return (data as { ciphertext: string } | null)?.ciphertext ?? null;
  }
  async putCiphertext(clientId: string, ciphertext: string, actorId: string | null) {
    const { error } = await this.db.from("client_ssn").upsert({ tenant_id: this.tenantId, client_id: clientId, ciphertext, sealed_by: actorId, sealed_at: new Date().toISOString() }, { onConflict: "tenant_id,client_id" });
    if (error) throw fail("number save failed", error);
  }
  async deleteCiphertext(clientId: string) {
    const { error } = await this.db.from("client_ssn").delete().eq("client_id", clientId);
    if (error) throw fail("number removal failed", error);
    await this.setLast4(clientId, null);
  }
  async setLast4(clientId: string, last4: string | null) {
    const { error } = await this.db.from("clients").update({ ssn_last4: last4 }).eq("id", clientId);
    if (error) throw fail("client update failed", error);
  }
  async audit(e: { action: string; clientId: string; actorId: string | null }) {
    const { error } = await this.db.from("workspace_audit_events").insert({ actor_id: e.actorId, action: e.action, subject_type: "client", subject_id: e.clientId, detail: {} });
    if (error) throw fail("audit failed", error);
  }
}
