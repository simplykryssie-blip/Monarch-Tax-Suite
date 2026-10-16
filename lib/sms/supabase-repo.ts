import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { unwrap } from "../commerce/supabase-repo.ts";
import type { CreditEntry, SmsAccount, SmsAccountPatch, SmsAccountsRepo } from "./types.ts";

/** tenant_sms_accounts and sms_credit_ledger on the tenant client: the tenant policies scope every call. */
export class SupabaseSmsAccountsRepo implements SmsAccountsRepo {
  constructor(private db: SupabaseClient) {}
  async get() { return unwrap(await this.db.from("tenant_sms_accounts").select("*").maybeSingle()) as SmsAccount | null; }
  async insert(input: SmsAccountPatch) { return unwrap(await this.db.from("tenant_sms_accounts").insert(input).select("*").single()) as SmsAccount; }
  async update(id: string, patch: SmsAccountPatch) { return unwrap(await this.db.from("tenant_sms_accounts").update(patch).eq("id", id).select("*").single()) as SmsAccount; }
  async balance() {
    const rows = unwrap(await this.db.from("sms_credit_ledger").select("delta").limit(100000)) as { delta: number }[];
    return rows.reduce((n, r) => n + r.delta, 0);
  }
  async ledger(limit: number) { return unwrap(await this.db.from("sms_credit_ledger").select("*").order("created_at", { ascending: false }).limit(limit)) as CreditEntry[]; }
  async spend(segments: number, reference: string) { return unwrap(await this.db.rpc("spend_sms_credits", { p_segments: segments, p_reference: reference })) === true; }
  async credit(entry: Pick<CreditEntry, "delta" | "kind" | "reference" | "note" | "created_by">) { unwrap(await this.db.from("sms_credit_ledger").insert(entry)); }
}
