import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { unwrap } from "../commerce/supabase-repo.ts";
import type { CreditEntry, SmsAccount, SmsAccountPatch, SmsAccountsRepo, SmsCheckout } from "./types.ts";

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
  async reverseSend(reference: string) { return Number(unwrap(await this.db.rpc("reverse_sms_send", { p_reference: reference })) ?? 0); }
  async creditPurchase(sessionId: string) { return Number(unwrap(await this.db.rpc("credit_sms_purchase", { p_session_id: sessionId })) ?? 0); }
  async chargeRenewal(credits: number, period: string, note: string) { return unwrap(await this.db.rpc("charge_sms_renewal", { p_credits: credits, p_period: period, p_note: note })) === true; }
  async forfeit(reference: string) { return Number(unwrap(await this.db.rpc("forfeit_sms_credits", { p_reference: reference })) ?? 0); }

  async insertCheckout(input: Pick<SmsCheckout, "purpose" | "number_type" | "packs" | "credits" | "amount_cents" | "created_by">) { return unwrap(await this.db.from("sms_checkouts").insert(input).select("*").single()) as SmsCheckout; }
  async updateCheckout(id: string, patch: Partial<Pick<SmsCheckout, "stripe_session_id" | "status" | "paid_at">>) { return unwrap(await this.db.from("sms_checkouts").update(patch).eq("id", id).select("*").single()) as SmsCheckout; }
  async findCheckout(sessionId: string) { return unwrap(await this.db.from("sms_checkouts").select("*").eq("stripe_session_id", sessionId).maybeSingle()) as SmsCheckout | null; }
}
