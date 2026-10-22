import type { Client, ClientMessage, ClientNote, NewClientMessage, WorkspaceRepo } from "../workspace/types.ts";
import type { Lead, LeadsRepo } from "../leads/types.ts";
import { leadSource } from "../leads/types.ts";
import type { PlannedMessage } from "./attach.ts";
import type { PlannedContact } from "./contacts.ts";
import type { ImportTarget } from "./service.ts";

// The four places an import can go. Each is a thin adapter over that place's own repository, so the same rules apply as
// when a person is added by hand there (ownership, office, tags). The adapters take small ports, so tests need no database.

const dated = (what: string, at: string | null, text: string) => `${what}${at ? ` (${at.slice(0, 10)})` : ""}: ${text}`.slice(0, 4000);
const tagsOf = (rows: { tags?: string[] | null }[]) => [...new Set(rows.flatMap((r) => r.tags ?? []))];

// ------------------------------------------------------------------ clients

export type ClientsPort = Pick<WorkspaceRepo, "listClients" | "insertClient" | "insertNote" | "insertMessage">;
/** `visible` is the clients this person may work with (their own, or everyone's for an owner or administrator). */
export function clientsTarget(ws: ClientsPort, who: { userId: string; organizationId: string | null; visible: () => Promise<Client[]> }): ImportTarget {
  const org = who.organizationId ?? undefined;
  return {
    destination: "clients",
    people: async (purpose) => {
      const rows = purpose === "attach" ? await who.visible() : await ws.listClients({ includeArchived: true, ...(org ? { organizationId: org } : {}) });
      return rows.map((c) => ({ id: c.id, name: c.full_name, email: c.email, phone: c.phone }));
    },
    add: async (p: PlannedContact) => {
      const c = await ws.insertClient({ full_name: p.full_name, email: p.email, phone: p.phone, ssn_last4: null, address: p.address, tags: p.tags, created_by: who.userId, owner_id: who.userId, organization_id: who.organizationId });
      if (p.note) await ws.insertNote({ client_id: c.id, body: dated("Imported note", null, p.note), created_by: who.userId });
      return c.id;
    },
    addNote: async (id, text, at) => { await ws.insertNote({ client_id: id, body: dated("Imported note", at, text), created_by: who.userId } satisfies Pick<ClientNote, "client_id" | "body" | "created_by">); },
    // Written down as history only ("logged", the default): nothing is sent to anyone.
    addMessage: async (id, m: PlannedMessage) => {
      const input: NewClientMessage = { client_id: id, direction: m.direction, channel: m.channel, subject: m.subject, body: m.body.slice(0, 4000), occurred_at: m.at ?? new Date().toISOString(), created_by: who.userId };
      await ws.insertMessage(input satisfies Pick<ClientMessage, "client_id" | "direction" | "channel" | "subject" | "body" | "occurred_at" | "created_by">);
    },
    knownTags: async () => tagsOf((await ws.listClients({ includeArchived: true, ...(org ? { organizationId: org } : {}) })) as unknown as { tags?: string[] }[]),
  };
}

// ------------------------------------------------------------------ leads

export function leadsTarget(repo: LeadsRepo, who: { userId: string }): ImportTarget {
  return {
    destination: "leads",
    people: async () => (await repo.listLeads({ limit: 5000 })).map((l: Lead) => ({ id: l.id, name: l.full_name, email: l.email, phone: l.phone })),
    add: async (p) => {
      const lead = await repo.insertLead({
        full_name: p.full_name, email: p.email!, phone: p.phone, firm_name: p.company && p.company !== p.full_name ? p.company : null, source: leadSource.import("CSV import"), status: "new",
        notes: p.note, tags: p.tags, last_contacted_at: null, audit_id: null, audit_score: null, wisp_plan_id: null, customer_id: null, order_id: null, organization_id: null, converted_at: null,
      });
      await repo.addEvent({ lead_id: lead.id, action: "imported", detail: { source: lead.source, row: p.row }, actor_id: who.userId });
      return lead.id;
    },
    addNote: async (id, text, at) => {
      const lead = await repo.getLead(id);
      if (!lead) throw new Error("lead not found");
      await repo.updateLead(id, { notes: [lead.notes, dated("Imported note", at, text)].filter(Boolean).join("\n\n").slice(0, 10000) });
    },
    knownTags: async () => (await repo.tagCounts()).map((t) => t.tag),
  };
}

// ------------------------------------------------------------------ store customers

export type CustomersPort = { listCustomers(): Promise<{ id: string; email: string; full_name: string | null }[]>; createCustomer(input: { email: string; full_name: string | null; stripe_customer_id: string | null }): Promise<{ id: string }> };
/** Store customers hold an email and a name only: no tags, notes or messages. */
export function customersTarget(repo: CustomersPort): ImportTarget {
  return {
    destination: "customers",
    people: async () => (await repo.listCustomers()).map((c) => ({ id: c.id, name: c.full_name, email: c.email, phone: null })),
    add: async (p) => (await repo.createCustomer({ email: p.email!, full_name: p.full_name, stripe_customer_id: null })).id,
  };
}

// ------------------------------------------------------------------ firms (EROs & EFINs)

export type FirmsPort = {
  listFirms(): Promise<{ id: string; legal_name: string; notes: string | null }[]>;
  insertFirm(input: { legal_name: string; dba_name: string | null; primary_address: { line1: string; city: string; state: string; zip: string }; notes: string | null; created_by: string }): Promise<{ id: string }>;
  setNotes(id: string, notes: string): Promise<void>;
  recordCreated(id: string): Promise<void>;
};
/** A firm is a business record in the Service Bureau area. It keeps a name, DBA, address and notes; it has no EFIN until one is added there. */
export function firmsTarget(port: FirmsPort, who: { userId: string }): ImportTarget {
  return {
    destination: "firms",
    people: async () => (await port.listFirms()).map((f) => ({ id: f.id, name: f.legal_name, email: null, phone: null })),
    add: async (p) => {
      const firm = await port.insertFirm({ legal_name: p.full_name, dba_name: p.dba, primary_address: p.parts, notes: p.note, created_by: who.userId });
      await port.recordCreated(firm.id);
      return firm.id;
    },
    addNote: async (id, text, at) => {
      const firm = (await port.listFirms()).find((f) => f.id === id);
      if (!firm) throw new Error("firm not found");
      await port.setNotes(id, [firm.notes, dated("Imported note", at, text)].filter(Boolean).join("\n\n").slice(0, 4000));
    },
  };
}
