// Text messaging per tenant. Each tax office sends from its own Twilio account:
// - tenant #1 (Monarch) from the owner's own account, set in Vercel; the owner pays Twilio directly.
// - every other tenant from its own Twilio subaccount under the owner's account, with its own API key, its own number
//   and its own carrier registration (A2P 10DLC). Twilio bills subaccounts to the parent account, so these tenants
//   prepay SMS credits: one credit is one message segment, taken before each text is sent and given back if it fails.

export type SmsAccountStatus = "setting_up" | "active" | "suspended";
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
  created_by: string | null;
  created_at: string;
  updated_at: string;
};
export type SmsAccountPatch = Partial<Omit<SmsAccount, "id" | "tenant_id" | "created_at" | "updated_at">>;

export type CreditEntry = { id: string; tenant_id: string; delta: number; kind: "purchase" | "grant" | "send" | "refund"; reference: string | null; note: string | null; created_by: string | null; created_at: string };

export interface SmsAccountsRepo {
  get(): Promise<SmsAccount | null>;
  insert(input: SmsAccountPatch): Promise<SmsAccount>;
  update(id: string, patch: SmsAccountPatch): Promise<SmsAccount>;
  balance(): Promise<number>;
  ledger(limit: number): Promise<CreditEntry[]>;
  /** Takes `segments` credits if the balance covers them, in one step. False when it doesn't. */
  spend(segments: number, reference: string): Promise<boolean>;
  credit(entry: Pick<CreditEntry, "delta" | "kind" | "reference" | "note" | "created_by">): Promise<void>;
}
