// One list of people from the three places they are kept today: leads (prospects), clients (the office prepares their return)
// and customers (they bought something in the store). A person found in more than one place is ONE contact here. Nothing is
// written or merged: this only reads the three lists and groups them, so it is safe to run on live data.
//
// The match is the one the rest of the app already uses (matchPerson): the same email. It is deliberately cautious:
//   - Two clients sharing an email stay two contacts (a couple on one address are two people). Nothing else is attached to them.
//   - A name or phone match never combines records; it is only reported as a *possible duplicate* for a person to review.

export type ContactKind = "lead" | "client" | "customer";

export type LeadRec = { id: string; full_name: string; email: string; phone: string | null; status: string; source: string; tags: string[]; last_contacted_at: string | null; updated_at: string };
export type ClientRec = { id: string; full_name: string; email: string | null; phone: string | null; archived_at: string | null; tags?: string[] | null; updated_at: string };
export type CustomerRec = { id: string; full_name: string | null; email: string; status: string; updated_at: string };

export type Chip = { kind: ContactKind; label: string; active: boolean };

export type Contact = {
  /** Stable, free of personal details: the anchor record's kind and id (client first, then lead, then customer). */
  key: string;
  name: string;
  email: string | null;
  phone: string | null;
  kinds: ContactKind[];
  chips: Chip[];
  /** At least one part is current (not an archived client, a lost or converted lead, or an inactive customer). */
  active: boolean;
  tags: string[];
  refs: { leadId: string | null; clientId: string | null; customerIds: string[] };
  lastActivity: string | null;
};

const ORDER: ContactKind[] = ["client", "lead", "customer"];

export const normalizeEmail = (v: string | null | undefined): string | null => {
  const e = (v ?? "").trim().toLowerCase();
  return e.includes("@") ? e : null;
};

/** Ten digits (a leading US 1 dropped), or null. */
export const normalizePhone = (v: string | null | undefined): string | null => {
  let d = (v ?? "").replace(/\D+/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d.length === 10 ? d : null;
};

/** Lower-cased first and last name only when there are at least two words (a single word is too common to compare). */
export const nameKey = (v: string | null | undefined): string | null => {
  const parts = (v ?? "").toLowerCase().replace(/[^\p{L}\s'-]/gu, " ").split(/\s+/).filter(Boolean);
  return parts.length >= 2 ? `${parts[0]} ${parts[parts.length - 1]}` : null;
};

const newest = (...dates: (string | null | undefined)[]) => dates.filter((d): d is string => Boolean(d)).sort().pop() ?? null;
const leadCurrent = (s: string) => s !== "converted" && s !== "lost";

type Group = { leads: LeadRec[]; clients: ClientRec[]; customers: CustomerRec[] };

function build(g: Group): Contact {
  const client = g.clients[0] ?? null;
  const lead = g.leads[0] ?? null;
  const customer = g.customers[0] ?? null;
  const anchor = client ? `client-${client.id}` : lead ? `lead-${lead.id}` : `customer-${customer!.id}`;
  const chips: Chip[] = [];
  for (const kind of ORDER) {
    if (kind === "client" && client) chips.push({ kind, label: client.archived_at ? "Client (archived)" : "Client", active: !client.archived_at });
    if (kind === "lead" && lead) chips.push({ kind, label: lead.status === "lost" ? "Lead (lost)" : lead.status === "converted" ? "Lead (converted)" : "Lead", active: leadCurrent(lead.status) });
    if (kind === "customer" && customer) {
      const live = g.customers.some((c) => c.status === "active");
      chips.push({ kind, label: live ? "Customer" : "Customer (archived)", active: live });
    }
  }
  const tags = [...new Set([...(client?.tags ?? []), ...(lead?.tags ?? [])])].sort();
  return {
    key: anchor,
    name: client?.full_name || lead?.full_name || customer?.full_name || normalizeEmail(customer?.email ?? lead?.email ?? client?.email) || "Unnamed contact",
    email: normalizeEmail(client?.email) ?? normalizeEmail(lead?.email) ?? normalizeEmail(customer?.email),
    phone: client?.phone || lead?.phone || null,
    kinds: chips.map((c) => c.kind),
    chips,
    active: chips.some((c) => c.active),
    tags,
    refs: { leadId: lead?.id ?? null, clientId: client?.id ?? null, customerIds: g.customers.map((c) => c.id) },
    lastActivity: newest(client?.updated_at, lead?.last_contacted_at, lead?.updated_at, ...g.customers.map((c) => c.updated_at)),
  };
}

export function combineContacts(input: { leads: LeadRec[]; clients: ClientRec[]; customers: CustomerRec[] }): Contact[] {
  const byEmail = new Map<string, Group>();
  const grab = (email: string): Group => {
    let g = byEmail.get(email);
    if (!g) byEmail.set(email, (g = { leads: [], clients: [], customers: [] }));
    return g;
  };
  const out: Contact[] = [];

  for (const l of input.leads) {
    const e = normalizeEmail(l.email);
    if (e) grab(e).leads.push(l);
    else out.push(build({ leads: [l], clients: [], customers: [] }));
  }
  for (const c of input.customers) {
    const e = normalizeEmail(c.email);
    if (e) grab(e).customers.push(c);
    else out.push(build({ leads: [], clients: [], customers: [c] }));
  }
  for (const c of input.clients) {
    const e = normalizeEmail(c.email);
    if (e) grab(e).clients.push(c);
    else out.push(build({ leads: [], clients: [c], customers: [] }));
  }

  for (const g of byEmail.values()) {
    if (g.clients.length > 1) {
      // Several clients on one address are separate people. Each is its own contact; the leads and customers with that address are
      // kept apart rather than guessed onto one of them, and the review list flags the shared address.
      for (const c of g.clients) out.push(build({ leads: [], clients: [c], customers: [] }));
      if (g.leads.length || g.customers.length) out.push(build({ leads: g.leads, clients: [], customers: g.customers }));
    } else {
      out.push(build(g));
    }
  }
  return out;
}

// ------------------------------------------------------------------ possible duplicates (for a person to review)

export type DuplicateReason = "shared_email" | "same_phone" | "same_name";
export type PossibleDuplicate = { a: string; b: string; reason: DuplicateReason };
export const DUPLICATE_REASON: Record<DuplicateReason, string> = {
  shared_email: "Share an email address",
  same_phone: "Same phone number",
  same_name: "Same first and last name",
};

/** Pairs of different contacts that might be the same person. Never merged automatically. */
export function possibleDuplicates(contacts: Contact[]): PossibleDuplicate[] {
  const seen = new Set<string>();
  const out: PossibleDuplicate[] = [];
  const add = (x: Contact, y: Contact, reason: DuplicateReason) => {
    if (x.key === y.key) return;
    const [a, b] = x.key < y.key ? [x.key, y.key] : [y.key, x.key];
    const id = `${a}|${b}`;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ a, b, reason });
  };
  const index = (pick: (c: Contact) => string | null) => {
    const m = new Map<string, Contact[]>();
    for (const c of contacts) {
      const k = pick(c);
      if (k) m.set(k, [...(m.get(k) ?? []), c]);
    }
    return [...m.values()].filter((v) => v.length > 1);
  };
  for (const list of index((c) => c.email)) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) add(list[i], list[j], "shared_email");
  for (const list of index((c) => normalizePhone(c.phone))) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) add(list[i], list[j], "same_phone");
  for (const list of index((c) => nameKey(c.name))) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) add(list[i], list[j], "same_name");
  return out;
}

// --------------------------------------------------------------------------- the list: filters, counts, order

export type ContactFilter = { q?: string; kind?: ContactKind | "inactive" | ""; /** Only contacts with this tag. */ tag?: string };

export function filterContacts(contacts: Contact[], f: ContactFilter): Contact[] {
  const term = (f.q ?? "").trim().toLowerCase();
  const digits = term.replace(/\D+/g, "");
  return contacts.filter((c) => {
    if (f.kind === "inactive") { if (c.active) return false; }
    else if (f.kind && !c.kinds.includes(f.kind)) return false;
    else if (!f.kind && !c.active) return false;
    if (f.tag && !c.tags.includes(f.tag)) return false;
    if (!term) return true;
    return c.name.toLowerCase().includes(term) || (c.email ?? "").includes(term) || (digits.length >= 4 && (normalizePhone(c.phone) ?? "").includes(digits)) || c.tags.some((t) => t.toLowerCase().includes(term));
  });
}

export function countContacts(contacts: Contact[]) {
  const active = contacts.filter((c) => c.active);
  return {
    all: active.length,
    lead: contacts.filter((c) => c.kinds.includes("lead")).length,
    client: contacts.filter((c) => c.kinds.includes("client")).length,
    customer: contacts.filter((c) => c.kinds.includes("customer")).length,
    inactive: contacts.length - active.length,
  };
}

/** Most recent activity first, then by name. */
export const sortContacts = (contacts: Contact[]): Contact[] =>
  [...contacts].sort((a, b) => (b.lastActivity ?? "").localeCompare(a.lastActivity ?? "") || a.name.localeCompare(b.name));

// ------------------------------------------------------------------------------------------------- keys

const KEY = /^(client|lead|customer)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
export function parseContactKey(key: unknown): { kind: ContactKind; id: string } | null {
  const m = typeof key === "string" ? KEY.exec(key) : null;
  return m ? { kind: m[1].toLowerCase() as ContactKind, id: m[2].toLowerCase() } : null;
}
