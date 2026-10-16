// Text messaging per tenant. Each tax office sends from its own Twilio account:
// - tenant #1 (Monarch) from the owner's own account, set in Vercel; the owner pays Twilio directly.
// - every other tenant from its own Twilio subaccount under the owner's account, with its own API key, its own number
//   and its own carrier registration (A2P 10DLC). Twilio bills subaccounts to the parent account, so these tenants
//   prepay SMS credits: one credit is one message segment, taken before each text is sent and given back if it fails.

export type SmsAccountStatus = "setting_up" | "active" | "paused" | "released" | "suspended";
/** US carriers block texts from a local number until the office's brand and campaign are approved (A2P 10DLC). */
export type SmsRegistration = "not_started" | "submitted" | "approved" | "rejected";

export type SmsAccount = {
  id: string;
  tenant_id: string;
  subaccount_sid: string | null;
  api_key_sid: string | null;
  /** The API key secret, encrypted with MONARCH_ENCRYPTION_KEY (AES-256-GCM, bound to the tenant). */
  api_key_secret_encrypted: string | null;
  from_number: string | null;
  phone_number_sid: string | null;
  messaging_service_sid: string | null;
  registration_status: SmsRegistration;
  status: SmsAccountStatus;
  number_type: "toll_free" | "local" | null;
  /** The guided registration answers (lib/sms/registration.ts). */
  registration: Record<string, unknown>;
  /** Twilio ids the registration produced, step by step. */
  registration_sids: Record<string, string>;
  registration_error: string | null;
  /** The number the office picked before paying; bought once the payment is confirmed. */
  chosen_number: string | null;
  setup_paid_at: string | null;
  provision_status: "none" | "provisioning" | "done" | "error";
  provision_error: string | null;
  renews_on: string | null;
  renewal_failed_at: string | null;
  renewal_attempts: number;
  released_at: string | null;
  forfeited_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};
export type SmsAccountPatch = Partial<Omit<SmsAccount, "id" | "tenant_id" | "created_at" | "updated_at">>;

export type CreditKind = "purchase" | "send" | "send_reversal" | "renewal" | "forfeit";
export type CreditEntry = { id: string; tenant_id: string; delta: number; kind: CreditKind; reference: string | null; note: string | null; created_by: string | null; created_at: string };

export type SmsCheckout = {
  id: string; tenant_id: string; stripe_session_id: string | null; purpose: "credits" | "setup"; number_type: "toll_free" | "local" | null;
  packs: number | null; credits: number | null; amount_cents: number; currency: "usd"; status: "open" | "paid" | "expired"; paid_at: string | null; created_by: string | null; created_at: string;
};

export interface SmsAccountsRepo {
  get(): Promise<SmsAccount | null>;
  insert(input: SmsAccountPatch): Promise<SmsAccount>;
  update(id: string, patch: SmsAccountPatch): Promise<SmsAccount>;
  balance(): Promise<number>;
  ledger(limit: number): Promise<CreditEntry[]>;
  /** Takes `segments` credits if the balance covers them, in one step. False when it doesn't. */
  spend(segments: number, reference: string): Promise<boolean>;
  /** Gives back what a refused text took, once. */
  reverseSend(reference: string): Promise<number>;
  /** Credits a confirmed credit-pack payment, once; the checkout row decides how many. */
  creditPurchase(sessionId: string): Promise<number>;
  /** Takes the month's number fee if the balance covers it; one charge per period. */
  chargeRenewal(credits: number, period: string, note: string): Promise<boolean>;
  forfeit(reference: string): Promise<number>;

  insertCheckout(input: Pick<SmsCheckout, "purpose" | "number_type" | "packs" | "credits" | "amount_cents" | "created_by">): Promise<SmsCheckout>;
  updateCheckout(id: string, patch: Partial<Pick<SmsCheckout, "stripe_session_id" | "status" | "paid_at">>): Promise<SmsCheckout>;
  findCheckout(sessionId: string): Promise<SmsCheckout | null>;
}
