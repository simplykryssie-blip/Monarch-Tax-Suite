// EFIN Management vocabulary. Kept free of server imports so rules and tests can load it directly.

export const ASSIGNMENT_STATES = ["draft", "pending_review", "approved", "active", "suspended", "revoked", "expired"] as const;
export type AssignmentState = (typeof ASSIGNMENT_STATES)[number];

export const ASSIGNMENT_ROLES = ["ero", "responsible_official", "principal", "tax_preparer", "office_administrator", "bureau_administrator"] as const;
export type AssignmentRole = (typeof ASSIGNMENT_ROLES)[number];

export const EFIN_STATUSES = ["draft", "pending_verification", "active", "renewal_review", "inactive", "suspended"] as const;
export type EfinStatus = (typeof EFIN_STATUSES)[number];

export const VERIFICATION = ["unverified", "manually_verified", "verified"] as const;
export type Verification = (typeof VERIFICATION)[number];

export const REMINDER_STAGES = [60, 30, 14, 7] as const;

export type EfinRow = {
  id: string;
  efin_last4: string;
  organization_id: string;
  location_id: string | null;
  ero_person_id: string | null;
  internal_status: EfinStatus;
  external_status: Verification;
  external_verified_at: string | null;
  verification_source: string | null;
  recorded_expiration: string | null;
  expiration_verified: boolean;
  tax_year: number | null;
  notes: string | null;
  archived_at: string | null;
  archived_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type OrgRow = {
  id: string;
  parent_id: string | null;
  kind: "bureau" | "partner" | "entity";
  legal_name: string;
  dba_name: string | null;
  business_structure: string | null;
  ein_last4: string | null;
  primary_address: Record<string, string>;
  relationship: "internal" | "partner" | "client" | "other";
  agreement_status: "pending" | "active" | "suspended" | "ended";
  onboarding_status: "not_started" | "in_progress" | "complete";
  administrator_person_id: string | null;
  status: "active" | "inactive";
  notes: string | null;
  archived_at: string | null;
  created_at: string;
};

export type LocationRow = { id: string; organization_id: string; name: string; address: Record<string, string>; is_primary: boolean; status: "active" | "inactive"; archived_at: string | null };

export type PersonRow = { id: string; full_name: string; email: string | null; phone: string | null; user_id: string | null; status: "active" | "inactive"; notes: string | null; archived_at: string | null; created_at: string };

export type CredentialRow = {
  id: string;
  person_id: string;
  kind: "ptin" | "caf" | "state_license" | "other";
  identifier_last4: string | null;
  verification_status: Verification;
  verification_source: string | null;
  verified_at: string | null;
  expires_on: string | null;
  archived_at: string | null;
};

export type RoleRow = { id: string; organization_id: string; person_id: string; role: AssignmentRole; location_id: string | null; status: "active" | "ended"; start_date: string | null; end_date: string | null; verification_status: Verification; verification_note: string | null };

export type AssignmentRow = {
  id: string;
  efin_id: string;
  organization_id: string;
  location_id: string | null;
  person_id: string | null;
  role: AssignmentRole;
  software_provider: string | null;
  state: AssignmentState;
  effective_from: string | null;
  effective_to: string | null;
  requested_by: string | null;
  requested_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_reason: string | null;
  activated_at: string | null;
  ended_at: string | null;
  end_reason: string | null;
};

export type FilingRow = { id: string; efin_id: string; organization_id: string; software_provider: string; software_product: string | null; tax_year: number | null; external_auth_status: Verification | "not_applicable"; verification_source: string | null; last_verified_at: string | null; remediation_note: string | null; archived_at: string | null };

export type RenewalTaskRow = {
  id: string;
  subject_type: "efin" | "credential" | "agreement" | "software";
  subject_id: string;
  organization_id: string | null;
  title: string;
  due_on: string;
  original_due_on: string;
  status: "open" | "urgent" | "escalated" | "overdue" | "done" | "cancelled";
  completed_at: string | null;
  completion_note: string | null;
  evidence_note: string | null;
};

export type AuditRow = { id: string; occurred_at: string; actor_id: string | null; actor_email: string | null; event_type: string; target_type: string | null; target_id: string | null; organization_id: string | null; changes: Record<string, unknown>; reason: string | null };
