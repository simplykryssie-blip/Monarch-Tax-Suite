import "server-only";
import { commerceRepo } from "../admin";
import { leadsDeps } from "../leads/server";
import { allows } from "../tier.ts";
import { currentTier } from "../tier-server";
import { workspaceRepo } from "../workspace/server";
import { combineContacts, possibleDuplicates, sortContacts, type ClientRec, type Contact, type CustomerRec, type LeadRec, type PossibleDuplicate } from "./combine.ts";

// Reads the three lists for the signed-in workspace and groups them (see combine.ts). It only reads: no record is created,
// changed or merged here. A source the plan doesn't include, or one that can't be read, is left out and said so; the others still show.

export type OrderLine = { id: string; order_number: number; customer_id: string; amount_cents: number; amount_refunded_cents: number; currency: string; payment_status: string; created_at: string };

export type ContactsData = {
  contacts: Contact[];
  duplicates: PossibleDuplicate[];
  /** Which sources were read, and a plain note for any that could not be. */
  included: { leads: boolean; clients: boolean; customers: boolean };
  notes: string[];
  orders: OrderLine[];
  leads: LeadRec[];
  clients: ClientRec[];
  customers: (CustomerRec & { archived: boolean })[];
};

async function attempt<T>(label: string, notes: string[], run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch {
    notes.push(`${label} couldn't be read just now, so they are not in this list.`);
    return null;
  }
}

export async function loadContacts(): Promise<ContactsData> {
  const tier = await currentTier();
  const notes: string[] = [];
  // Leads are in every plan's Contacts: people who book, fill in a form or are added from the calendar land here.
  const wantLeads = true;
  const wantCustomers = allows(tier, "store");
  const [leadRows, clientRows, customerRows, orderRows] = await Promise.all([
    wantLeads ? attempt("Leads", notes, () => leadsDeps().repo.listLeads({ limit: 5000 })) : Promise.resolve(null),
    attempt("Clients", notes, () => workspaceRepo().listClients({ includeArchived: true })),
    wantCustomers ? attempt("Customers", notes, () => commerceRepo().listCustomers()) : Promise.resolve(null),
    wantCustomers ? attempt("Orders", notes, () => commerceRepo().listOrders()) : Promise.resolve(null),
  ]);
  const leads: LeadRec[] = (leadRows ?? []).map((l) => ({ id: l.id, full_name: l.full_name, email: l.email, phone: l.phone, status: l.status, source: l.source, tags: l.tags ?? [], last_contacted_at: l.last_contacted_at, updated_at: l.updated_at, assigned_to: l.assigned_to ?? null }));
  const clients: ClientRec[] = (clientRows ?? []).map((c) => ({ id: c.id, full_name: c.full_name, email: c.email, phone: c.phone, archived_at: c.archived_at, tags: c.tags ?? [], updated_at: c.updated_at, owner_id: c.owner_id ?? null }));
  const customers = (customerRows ?? []).map((c) => ({ id: c.id, full_name: c.full_name, email: c.email, status: c.archived_at ? "inactive" : c.status, updated_at: c.updated_at, archived: Boolean(c.archived_at) }));
  const contacts = sortContacts(combineContacts({ leads, clients, customers }));
  return {
    contacts,
    duplicates: possibleDuplicates(contacts),
    included: { leads: leadRows !== null, clients: clientRows !== null, customers: customerRows !== null },
    notes,
    orders: (orderRows ?? []).map((o) => ({ id: o.id, order_number: o.order_number, customer_id: o.customer_id, amount_cents: o.amount_cents, amount_refunded_cents: o.amount_refunded_cents, currency: o.currency, payment_status: o.payment_status, created_at: o.created_at })),
    leads,
    clients,
    customers,
  };
}
