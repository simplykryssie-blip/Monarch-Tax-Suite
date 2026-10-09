// Buyer-owned CRM destinations. Monarch forwards each calculator lead to the
// buyer's destination during the visitor's request and stores no lead data.

export type ConnectionStatus = "connected" | "reauth_required" | "disconnected";
export type Provider = "highlevel" | "webhook";

export type CrmConnection = {
  id: string;
  license_id: string;
  customer_id: string;
  provider: Provider;
  // HighLevel
  location_id: string | null;
  location_name: string | null;
  company_id: string | null;
  scopes: string[];
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  token_expires_at: string | null;
  refresh_lock_until: string | null;
  last_refresh_at: string | null;
  // Webhook
  webhook_url_enc: string | null;
  webhook_host: string | null;
  signing_secret_enc: string | null;
  // Common
  status: ConnectionStatus;
  last_success_at: string | null;
  last_checked_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  connected_at: string;
  disconnected_at: string | null;
  created_at: string;
  updated_at: string;
};

export type NewConnection = Pick<CrmConnection, "license_id" | "customer_id" | "provider" | "status"> &
  Partial<Pick<CrmConnection, "location_id" | "location_name" | "company_id" | "scopes" | "access_token_enc" | "refresh_token_enc" | "token_expires_at" | "webhook_url_enc" | "webhook_host" | "signing_secret_enc" | "last_checked_at">>;

/** Buyer's lead-form configuration (no personal data). */
export type LeadSettings = {
  license_id: string;
  enabled: boolean;
  business_name: string | null;
  lead_source: string;
  tags: string[];
  /** HighLevel only: update a matching contact with submitted details (upsert); otherwise existing contacts are left unchanged. */
  update_existing: boolean;
  /** Include the estimate summary (tax year, filing status, estimated refund/amount owed). Disclosed on the form. */
  include_summary: boolean;
  updated_at: string;
};

export const DEFAULT_LEAD_SETTINGS = (licenseId: string): LeadSettings => ({
  license_id: licenseId,
  enabled: false,
  business_name: null,
  lead_source: "Monarch Tax Calculator",
  tags: [],
  update_existing: false,
  include_summary: true,
  updated_at: new Date(0).toISOString(),
});

/** A lead held in memory only while it is forwarded. Never persisted by Monarch. */
export type LeadPayload = {
  submissionId: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  summary: { taxYear: number; filingStatus: string; result: "refund" | "owed"; amount: number } | null;
  /** Full-calculator results, recomputed on the server from the visitor's inputs (the inputs themselves are not forwarded). */
  estimate: import("../calculator/full.ts").FullLeadEstimate | null;
  submittedAt: string;
};

/** Diagnostics only: no names, emails, phones or calculator values. */
export type DeliveryLogEntry = {
  id: string;
  license_id: string;
  provider: Provider | null;
  outcome: "sent" | "failed" | "rejected";
  reason: string | null;
  http_status: number | null;
  duration_ms: number | null;
  ip_hash: string | null;
  created_at: string;
};

export interface CrmRepo {
  createOAuthState(input: { state_hash: string; license_id: string; expires_at: string }): Promise<void>;
  /** Atomically marks an unused, unexpired state as used and returns the license it was issued for. */
  consumeOAuthState(stateHash: string, now: string): Promise<string | null>;

  getLiveConnection(licenseId: string): Promise<CrmConnection | null>;
  getConnection(id: string): Promise<CrmConnection | null>;
  insertConnection(input: NewConnection): Promise<CrmConnection>;
  updateConnection(id: string, patch: Partial<Omit<CrmConnection, "id" | "license_id" | "customer_id" | "created_at">>): Promise<CrmConnection>;
  /** Claims the token-refresh lock if free. */
  claimRefreshLock(id: string, until: string, now: string): Promise<boolean>;

  getLeadSettings(licenseId: string): Promise<LeadSettings | null>;
  saveLeadSettings(settings: Omit<LeadSettings, "updated_at">): Promise<LeadSettings>;

  logDelivery(entry: Omit<DeliveryLogEntry, "id" | "created_at">): Promise<void>;
  countDeliveries(filter: { license_id?: string; ip_hash?: string }, since: string): Promise<number>;
  listDeliveries(licenseId: string, limit: number): Promise<DeliveryLogEntry[]>;
  /** Clears ip hashes older than `ipBefore` and deletes entries older than `deleteBefore`. */
  pruneDeliveryLog(ipBefore: string, deleteBefore: string): Promise<void>;
}
