import { randomUUID } from "node:crypto";
import { matchesFilter } from "../lib/leads/service.ts";
import type { Lead, LeadEvent, LeadFilter, LeadInsert, LeadsRepo } from "../lib/leads/types.ts";

// Leads in memory, with the database's one-email-per-tenant rule. Returns copies, like the database.

export class MemoryLeads implements LeadsRepo {
  leads: Lead[] = [];
  events: LeadEvent[] = [];
  clock: () => Date = () => new Date();
  private c = <T>(v: T): T => structuredClone(v);
  async listLeads(f: LeadFilter) { return this.c(this.leads.filter((l) => matchesFilter(l, f)).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, f.limit ?? 500)); }
  async getLead(id: string) { return this.c(this.leads.find((l) => l.id === id) ?? null); }
  async findByEmail(email: string) { return this.c(this.leads.find((l) => l.email === email) ?? null); }
  async findByAudit(auditId: string) { return this.c(this.leads.find((l) => l.audit_id === auditId) ?? null); }
  async existingEmails(emails: string[]) { return new Set(this.leads.filter((l) => emails.includes(l.email)).map((l) => l.email)); }
  async insertLead(input: LeadInsert) {
    if (this.leads.some((l) => l.email === input.email)) throw new Error('duplicate key value violates unique constraint "leads_email_key"');
    const at = this.clock().toISOString();
    const l: Lead = { ...this.c(input), id: randomUUID(), tenant_id: "t", created_at: at, updated_at: at };
    this.leads.push(l);
    return this.c(l);
  }
  async updateLead(id: string, patch: Partial<Lead>) {
    const l = this.leads.find((x) => x.id === id)!;
    if (patch.email && this.leads.some((x) => x.id !== id && x.email === patch.email)) throw new Error("duplicate key leads_email_key");
    Object.assign(l, this.c(patch), { updated_at: this.clock().toISOString() });
    return this.c(l);
  }
  async deleteLead(id: string) { this.leads = this.leads.filter((l) => l.id !== id); this.events = this.events.filter((e) => e.lead_id !== id); }
  async addEvent(e: Omit<LeadEvent, "id" | "tenant_id" | "created_at">) { this.events.push({ ...this.c(e), id: randomUUID(), tenant_id: "t", created_at: this.clock().toISOString() }); }
  async listEvents(leadId: string) { return this.c(this.events.filter((e) => e.lead_id === leadId).reverse()); }
}
