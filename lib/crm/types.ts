// Data model for buyer-specific CRM (HighLevel) lead delivery.

export type ConnectionStatus = "connected" | "reauth_required" | "disconnected";

export type CrmConnection = {
  id: string;
  license_id: string;
  customer_id: string;
  provider: "highlevel";
  location_id: string;
  location_name: string | null;
  company_id: string | null;
  scopes: string[];
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  token_expires_at: string | null;
  status: ConnectionStatus;
  refresh_lock_until: string | null;
  last_refresh_at: string | null;
  last_success_at: string | null;
  last_checked_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  connected_at: string;
  disconnected_at: string | null;
  created_at: string;
  updated_at: string;
};

export type NewConnection = Pick<CrmConnection, "license_id" | "customer_id" | "location_id" | "location_name" | "company_id" | "scopes" | "access_token_enc" | "refresh_token_enc" | "token_expires_at" | "status" | "last_checked_at">;

export type LeadSettings = {
  license_id: string;
  enabled: boolean;
  business_name: string | null;
  lead_source: string;
  tags: string[];
  /** When true, matching contacts are updated with submitted details (HighLevel upsert); otherwise existing contacts are left unchanged. */
  update_existing: boolean;
  /** Adds a note with the estimate summary (tax year, filing status, estimated refund/amount owed). Disclosed on the form. */
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

export type LeadStatus = "received" | "sending" | "sent" | "retry_pending" | "reauth_required" | "failed";

export type CalculatorLead = {
  id: string;
  license_id: string;
  connection_id: string | null;
  submission_id: string;
  location_id: string | null;
  status: LeadStatus;
  payload_enc: string | null;
  email_masked: string | null;
  embed_host: string | null;
  ip_hash: string | null;
  attempts: number;
  next_attempt_at: string | null;
  lock_until: string | null;
  last_error: string | null;
  ghl_contact_id: string | null;
  contact_created: boolean | null;
  tags_applied: boolean;
  note_added: boolean;
  delivered_at: string | null;
  payload_purged_at: string | null;
  created_at: string;
  updated_at: string;
};

export type NewLead = Pick<CalculatorLead, "license_id" | "connection_id" | "submission_id" | "location_id" | "status" | "payload_enc" | "email_masked" | "embed_host" | "ip_hash" | "next_attempt_at">;

/** What the visitor submitted (stored encrypted until delivered). */
export type LeadPayload = {
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  summary: { taxYear: number; filingStatus: string; result: "refund" | "owed"; amount: number } | null;
  submittedAt: string;
};

export type LeadPatch = Partial<Omit<CalculatorLead, "id" | "license_id" | "submission_id" | "created_at" | "updated_at">>;

export interface CrmRepo {
  createOAuthState(input: { state_hash: string; license_id: string; expires_at: string }): Promise<void>;
  /** Atomically marks an unused, unexpired state for this license as used. */
  consumeOAuthState(stateHash: string, licenseId: string, now: string): Promise<boolean>;

  getLiveConnection(licenseId: string): Promise<CrmConnection | null>;
  getConnection(id: string): Promise<CrmConnection | null>;
  insertConnection(input: NewConnection): Promise<CrmConnection>;
  updateConnection(id: string, patch: Partial<Omit<CrmConnection, "id" | "license_id" | "customer_id" | "created_at">>): Promise<CrmConnection>;
  /** Claims the token-refresh lock if free (lock_until in the past or empty). */
  claimRefreshLock(id: string, until: string, now: string): Promise<boolean>;

  getLeadSettings(licenseId: string): Promise<LeadSettings | null>;
  saveLeadSettings(settings: Omit<LeadSettings, "updated_at">): Promise<LeadSettings>;

  /** Inserts a lead; for a repeated (license, submission) returns the existing row with created=false. */
  insertLead(input: NewLead): Promise<{ lead: CalculatorLead; created: boolean }>;
  getLead(id: string): Promise<CalculatorLead | null>;
  updateLead(id: string, patch: LeadPatch): Promise<CalculatorLead>;
  /** Claims a due lead for delivery (status received/retry_pending due now, or a stale 'sending' lock). */
  claimLead(id: string, lockUntil: string, now: string): Promise<CalculatorLead | null>;
  listDueLeadIds(now: string, limit: number, licenseId?: string): Promise<string[]>;
  listLeads(licenseId: string, limit: number): Promise<CalculatorLead[]>;
  listLeadsByStatus(licenseId: string, statuses: LeadStatus[]): Promise<CalculatorLead[]>;
  countLeadsSince(filter: { license_id?: string; ip_hash?: string }, since: string): Promise<number>;
  leadCounts(licenseId: string): Promise<Record<LeadStatus, number>>;
  /** Payloads to purge: delivered, or undelivered and older than the retention window. */
  listPurgeableLeadIds(olderThan: string, limit: number): Promise<string[]>;
  deleteLeadsBefore(before: string): Promise<number>;
}
