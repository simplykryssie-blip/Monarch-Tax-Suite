import { randomUUID } from "node:crypto";
import { retentionUntil } from "../lib/compliance/rules.ts";
import type {
  Ack, Attestation, ComplianceEvent, ComplianceItem, ComplianceRepo, ComplianceSettings, DocKind, Form8879, Incident, Notice, PtinRenewal, TeamMember, VaultDocument,
} from "../lib/compliance/types.ts";

// Compliance rows in memory, with the database's rules that matter here: retention worked out on save, one
// acknowledgment per person and attestation, one renewal per person and year, one notice per key. Returns copies.

export class MemoryCompliance implements ComplianceRepo {
  settings: ComplianceSettings[] = [];
  docs: VaultDocument[] = [];
  attestations: Attestation[] = [];
  acks: Ack[] = [];
  records: Form8879[] = [];
  renewals: PtinRenewal[] = [];
  incidents: Incident[] = [];
  items: ComplianceItem[] = [];
  events: ComplianceEvent[] = [];
  notices: Notice[] = [];
  team: TeamMember[] = [];
  offices: { id: string; name: string; archived: boolean }[] = [];
  clock: () => Date = () => new Date();
  private c = <T>(v: T): T => structuredClone(v);
  private ts = () => this.clock().toISOString();

  async getSettings(officeId: string) { return this.c(this.settings.find((s) => s.organization_id === officeId) ?? null); }
  async saveSettings(officeId: string, patch: Partial<ComplianceSettings>) {
    let s = this.settings.find((x) => x.organization_id === officeId);
    if (!s) { s = { id: randomUUID(), organization_id: officeId, review_months: 12, review_reminder_days: [30, 7], retention_alert_days: 90, ptin_reminder_every_days: 14, liaison_name: null, liaison_phone: null, liaison_email: null, liaison_notes: null, updated_at: this.ts() }; this.settings.push(s); }
    Object.assign(s, this.c(patch), { updated_at: this.ts() });
    return this.c(s);
  }

  async listDocuments(officeId: string, f: { kind?: DocKind; q?: string; includePending?: boolean } = {}) {
    return this.c(this.docs.filter((d) => d.organization_id === officeId && (f.includePending || d.status === "stored") && (!f.kind || d.kind === f.kind) && (!f.q || d.title.toLowerCase().includes(f.q.toLowerCase()))).reverse());
  }
  async getDocument(id: string) { return this.c(this.docs.find((d) => d.id === id) ?? null); }
  async insertDocument(input: Omit<VaultDocument, "id" | "created_at">) { const d = { ...this.c(input), id: randomUUID(), created_at: this.ts() }; this.docs.push(d); return this.c(d); }
  async updateDocument(id: string, patch: Partial<VaultDocument>) { const d = this.docs.find((x) => x.id === id)!; Object.assign(d, this.c(patch)); return this.c(d); }
  async deleteDocument(id: string) {
    this.docs = this.docs.filter((d) => d.id !== id);
    for (const a of this.attestations) if (a.document_id === id) a.document_id = null;
    for (const r of this.records) if (r.document_id === id) r.document_id = null;
  }
  async listStalePending(before: string) { return this.c(this.docs.filter((d) => d.status === "pending" && d.created_at < before)); }

  async listAttestations(officeId: string) { return this.c(this.attestations.filter((a) => a.organization_id === officeId).sort((a, b) => b.attested_at.localeCompare(a.attested_at))); }
  async insertAttestation(input: Omit<Attestation, "id" | "created_at" | "attested_at">) { const a = { ...this.c(input), id: randomUUID(), attested_at: this.ts(), created_at: this.ts() }; this.attestations.push(a); return this.c(a); }
  async listAcks(attestationId: string) { return this.c(this.acks.filter((a) => a.attestation_id === attestationId)); }
  async insertAck(input: Omit<Ack, "id" | "acknowledged_at">) {
    if (this.acks.some((a) => a.attestation_id === input.attestation_id && a.member_id === input.member_id)) throw new Error("duplicate key compliance_acks_member_key");
    const a = { ...this.c(input), id: randomUUID(), acknowledged_at: this.ts() }; this.acks.push(a); return this.c(a);
  }

  async list8879(officeId: string, f: { q?: string; taxYear?: number } = {}) {
    return this.c(this.records.filter((r) => r.organization_id === officeId && (!f.taxYear || r.tax_year === f.taxYear) && (!f.q || `${r.return_ref} ${r.taxpayer_name}`.toLowerCase().includes(f.q.toLowerCase()))).sort((a, b) => a.retention_until.localeCompare(b.retention_until)));
  }
  async get8879(id: string) { return this.c(this.records.find((r) => r.id === id) ?? null); }
  async insert8879(input: Omit<Form8879, "id" | "created_at" | "updated_at" | "retention_until">) {
    const r: Form8879 = { ...this.c(input), id: randomUUID(), retention_until: retentionUntil(input.due_date, input.received_date), created_at: this.ts(), updated_at: this.ts() };
    this.records.push(r); return this.c(r);
  }
  async update8879(id: string, patch: Partial<Form8879>) {
    const r = this.records.find((x) => x.id === id)!;
    Object.assign(r, this.c(patch), { updated_at: this.ts() });
    r.retention_until = retentionUntil(r.due_date, r.received_date);
    return this.c(r);
  }
  async delete8879(id: string) { this.records = this.records.filter((r) => r.id !== id); }

  async listRenewals(officeId: string, year: number) { return this.c(this.renewals.filter((r) => r.organization_id === officeId && r.renewal_year === year)); }
  async saveRenewal(input: Omit<PtinRenewal, "id" | "recorded_at">) {
    const found = this.renewals.find((r) => r.member_id === input.member_id && r.renewal_year === input.renewal_year);
    if (found) { Object.assign(found, this.c(input), { recorded_at: this.ts() }); return this.c(found); }
    const r = { ...this.c(input), id: randomUUID(), recorded_at: this.ts() }; this.renewals.push(r); return this.c(r);
  }

  async listIncidents(officeId: string) { return this.c(this.incidents.filter((i) => i.organization_id === officeId).reverse()); }
  async getIncident(id: string) { return this.c(this.incidents.find((i) => i.id === id) ?? null); }
  async insertIncident(input: Parameters<ComplianceRepo["insertIncident"]>[0]) {
    const i: Incident = { ...this.c(input), id: randomUUID(), status: "open", steps: {}, irs_notified_on: null, ftc_notified_on: null, closed_at: null, created_at: this.ts(), updated_at: this.ts() };
    this.incidents.push(i); return this.c(i);
  }
  async updateIncident(id: string, patch: Partial<Incident>) { const i = this.incidents.find((x) => x.id === id)!; Object.assign(i, this.c(patch), { updated_at: this.ts() }); return this.c(i); }

  async listItems(officeId: string) { return this.c(this.items.filter((i) => i.organization_id === officeId)); }
  async getItem(id: string) { return this.c(this.items.find((i) => i.id === id) ?? null); }
  async insertItem(input: Parameters<ComplianceRepo["insertItem"]>[0]) { const i: ComplianceItem = { ...this.c(input), id: randomUUID(), done_at: null, done_by: null, done_by_name: null, created_at: this.ts(), updated_at: this.ts() }; this.items.push(i); return this.c(i); }
  async updateItem(id: string, patch: Partial<ComplianceItem>) { const i = this.items.find((x) => x.id === id)!; Object.assign(i, this.c(patch), { updated_at: this.ts() }); return this.c(i); }
  async deleteItem(id: string) { this.items = this.items.filter((i) => i.id !== id); }

  async addEvent(e: Omit<ComplianceEvent, "id" | "created_at">) { this.events.push({ ...this.c(e), id: randomUUID(), created_at: this.ts() }); }
  async listEvents(officeId: string, f: { entity?: ComplianceEvent["entity"]; recordId?: string; limit?: number } = {}) {
    return this.c(this.events.filter((e) => e.organization_id === officeId && (!f.entity || e.entity === f.entity) && (!f.recordId || e.record_id === f.recordId)).reverse().slice(0, f.limit ?? 100));
  }

  async listTeam(officeId: string) { return this.c(this.team.filter((m) => m.organization_id === officeId)); }
  async listOffices() { return this.c(this.offices); }

  async claimNotice(input: { organization_id: string; notice_key: string; recipient: string }) {
    const found = this.notices.find((n) => n.notice_key === input.notice_key && n.recipient === input.recipient);
    if (found) return found.status === "failed" && found.attempts < 4 ? this.c(found) : null;
    const n: Notice = { ...input, id: randomUUID(), status: "pending", attempts: 0, last_error: null, created_at: this.ts(), sent_at: null };
    this.notices.push(n); return this.c(n);
  }
  async finishNotice(id: string, patch: Partial<Notice>) { Object.assign(this.notices.find((n) => n.id === id)!, this.c(patch)); }
}
