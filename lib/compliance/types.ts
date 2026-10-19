// Compliance Center records. Every row belongs to one office (an organizations row) of one tenant.

export type ComplianceSettings = {
  id: string; organization_id: string; review_months: number; review_reminder_days: number[]; retention_alert_days: number;
  ptin_reminder_every_days: number; liaison_name: string | null; liaison_phone: string | null; liaison_email: string | null;
  liaison_notes: string | null; updated_at: string;
};
export const DEFAULT_SETTINGS = { review_months: 12, review_reminder_days: [30, 7], retention_alert_days: 90, ptin_reminder_every_days: 14 } as const;

export const DOC_KINDS = { "8879": "Form 8879", wisp: "WISP", training: "Training record", acknowledgment: "Signed acknowledgment", other: "Other" } as const;
export type DocKind = keyof typeof DOC_KINDS;
export type VaultDocument = {
  id: string; organization_id: string; kind: DocKind; title: string; file_path: string; file_type: "pdf" | "docx"; size_bytes: number | null;
  sha256: string | null; status: "pending" | "stored"; retention_until: string | null; answers_sealed: string | null;
  uploaded_by: string | null; uploaded_by_name: string | null; created_at: string;
};

export type Attestation = {
  id: string; organization_id: string; source: "built" | "uploaded"; document_id: string | null; statement: string;
  attested_by: string | null; attested_name: string; attested_at: string; review_due: string; created_at: string;
};
export type Ack = { id: string; organization_id: string; attestation_id: string; member_id: string; member_name: string; acknowledged_at: string };

export const LOCATIONS = { vault: "Document vault", software: "Tax software", paper: "Paper file", other: "Other" } as const;
export type Location8879 = keyof typeof LOCATIONS;
export type Form8879 = {
  id: string; organization_id: string; return_id: string | null; tax_year: number; return_ref: string; taxpayer_name: string;
  signed_on: string; location: Location8879; location_note: string | null; document_id: string | null; due_date: string;
  received_date: string | null; retention_until: string; created_by: string | null; created_by_name: string | null; created_at: string; updated_at: string;
};

export type PtinRenewal = { id: string; organization_id: string; member_id: string; renewal_year: number; renewed: boolean; renewed_on: string | null; recorded_by: string | null; recorded_at: string };

export type StepRecord = { done_at: string; by: string | null; by_name: string; note?: string; skipped?: boolean };
export type Incident = {
  id: string; organization_id: string; title: string; summary: string | null; discovered_on: string; people_affected: number | null;
  info_encrypted: "yes" | "no" | "unknown"; status: "open" | "closed"; steps: Record<string, StepRecord>; irs_notified_on: string | null;
  ftc_notified_on: string | null; reported_by: string | null; reported_by_name: string | null; closed_at: string | null; created_at: string; updated_at: string;
};

export type ComplianceItem = {
  id: string; organization_id: string; title: string; description: string | null; due_on: string | null; repeat: "once" | "yearly";
  done_at: string | null; done_by: string | null; done_by_name: string | null; created_by: string | null; created_at: string; updated_at: string;
};

export type ComplianceEvent = {
  id: string; organization_id: string | null; entity: "attestation" | "ack" | "8879" | "document" | "ptin" | "incident" | "item" | "settings";
  record_id: string | null; action: string; actor_id: string | null; actor_name: string | null; reason: string | null; detail: Record<string, unknown>; created_at: string;
};

export type Notice = { id: string; organization_id: string; notice_key: string; recipient: string; status: "pending" | "sent" | "failed" | "held_back"; attempts: number; last_error: string | null; created_at: string; sent_at: string | null };

/** The team member the Compliance Center needs: name, email, role and status, from office_members. */
export type TeamMember = { id: string; organization_id: string; role: "ero" | "preparer"; email: string; full_name: string; status: "invited" | "active" | "suspended" };

export interface ComplianceRepo {
  getSettings(officeId: string): Promise<ComplianceSettings | null>;
  saveSettings(officeId: string, patch: Partial<ComplianceSettings>): Promise<ComplianceSettings>;

  listDocuments(officeId: string, f?: { kind?: DocKind; q?: string; includePending?: boolean }): Promise<VaultDocument[]>;
  getDocument(id: string): Promise<VaultDocument | null>;
  insertDocument(input: Omit<VaultDocument, "id" | "created_at">): Promise<VaultDocument>;
  updateDocument(id: string, patch: Partial<VaultDocument>): Promise<VaultDocument>;
  deleteDocument(id: string): Promise<void>;
  listStalePending(before: string): Promise<VaultDocument[]>;

  listAttestations(officeId: string): Promise<Attestation[]>;
  insertAttestation(input: Omit<Attestation, "id" | "created_at" | "attested_at">): Promise<Attestation>;
  listAcks(attestationId: string): Promise<Ack[]>;
  insertAck(input: Omit<Ack, "id" | "acknowledged_at">): Promise<Ack>;

  list8879(officeId: string, f?: { q?: string; taxYear?: number }): Promise<Form8879[]>;
  get8879(id: string): Promise<Form8879 | null>;
  insert8879(input: Omit<Form8879, "id" | "created_at" | "updated_at" | "retention_until">): Promise<Form8879>;
  update8879(id: string, patch: Partial<Form8879>): Promise<Form8879>;
  delete8879(id: string): Promise<void>;

  listRenewals(officeId: string, year: number): Promise<PtinRenewal[]>;
  saveRenewal(input: Omit<PtinRenewal, "id" | "recorded_at">): Promise<PtinRenewal>;

  listIncidents(officeId: string): Promise<Incident[]>;
  getIncident(id: string): Promise<Incident | null>;
  insertIncident(input: Omit<Incident, "id" | "created_at" | "updated_at" | "closed_at" | "status" | "steps" | "irs_notified_on" | "ftc_notified_on">): Promise<Incident>;
  updateIncident(id: string, patch: Partial<Incident>): Promise<Incident>;

  listItems(officeId: string): Promise<ComplianceItem[]>;
  getItem(id: string): Promise<ComplianceItem | null>;
  insertItem(input: Omit<ComplianceItem, "id" | "created_at" | "updated_at" | "done_at" | "done_by" | "done_by_name">): Promise<ComplianceItem>;
  updateItem(id: string, patch: Partial<ComplianceItem>): Promise<ComplianceItem>;
  deleteItem(id: string): Promise<void>;

  addEvent(e: Omit<ComplianceEvent, "id" | "created_at">): Promise<void>;
  listEvents(officeId: string, f?: { entity?: ComplianceEvent["entity"]; recordId?: string; limit?: number }): Promise<ComplianceEvent[]>;

  listTeam(officeId: string): Promise<TeamMember[]>;
  listOffices(): Promise<{ id: string; name: string; archived: boolean }[]>;

  /** Records a reminder before it is sent; false when this one was already recorded (so it's never sent twice). */
  claimNotice(input: { organization_id: string; notice_key: string; recipient: string }): Promise<Notice | null>;
  finishNotice(id: string, patch: Partial<Notice>): Promise<void>;
}
