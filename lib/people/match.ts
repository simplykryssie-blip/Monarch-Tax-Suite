import { checkEmail, checkName, checkPhone } from "../leads/service.ts";
import type { Lead, LeadsDeps } from "../leads/types.ts";

// One person can be a customer (bought something), a lead (a prospect) and a client (the office prepares their return)
// at once. matchPerson finds them by email across all three. Every record found is updated; when none exists the person
// becomes a lead. Booking, forms and the portal use it, so the same person is never entered twice.

export type PersonKind = "customer" | "lead" | "client";
export type PersonRef = { kind: PersonKind; id: string };
export type ClientMatch = { id: string; phone: string | null };

export interface PeopleRepo {
  findCustomers(email: string): Promise<{ id: string }[]>;
  findClients(email: string): Promise<ClientMatch[]>;
  fillClientPhone(id: string, phone: string): Promise<void>;
}
export type PeopleDeps = { people: PeopleRepo; leads: LeadsDeps["repo"] };

export type MatchInput = { email: unknown; name?: unknown; phone?: unknown; source: string; event?: string; tag?: string };
export type MatchResult = { email: string; matches: PersonRef[]; created: PersonRef | null };

const optionalPhone = (raw: unknown): string | null => {
  if (raw === undefined || raw === null || raw === "") return null;
  try { return checkPhone(raw); } catch { return null; }
};
const withTag = (lead: Lead, tag: string | undefined) => (tag && !lead.tags.includes(tag) ? [...lead.tags, tag] : null);

export async function matchPerson(deps: PeopleDeps, input: MatchInput): Promise<MatchResult> {
  const email = checkEmail(input.email);
  const phone = optionalPhone(input.phone);
  const [customers, clients, lead] = await Promise.all([deps.people.findCustomers(email), deps.people.findClients(email), deps.leads.findByEmail(email)]);
  const matches: PersonRef[] = [
    ...customers.map((c) => ({ kind: "customer" as const, id: c.id })),
    ...(lead ? [{ kind: "lead" as const, id: lead.id }] : []),
    ...clients.map((c) => ({ kind: "client" as const, id: c.id })),
  ];

  for (const c of clients) if (!c.phone && phone) await deps.people.fillClientPhone(c.id, phone);
  if (lead) {
    const tags = withTag(lead, input.tag);
    const patch: Partial<Lead> = { ...(!lead.phone && phone ? { phone } : {}), ...(tags ? { tags } : {}) };
    if (Object.keys(patch).length) await deps.leads.updateLead(lead.id, patch);
    await deps.leads.addEvent({ lead_id: lead.id, action: input.event ?? "matched", detail: { source: input.source }, actor_id: null });
  }
  if (matches.length) return { email, matches, created: null };

  const fromEmail = email.split("@")[0].replace(/[._-]+/g, " ").trim() || "New contact";
  const full_name = typeof input.name === "string" && input.name.trim() ? checkName(input.name) : fromEmail.slice(0, 200);
  let created: Lead;
  try {
    created = await deps.leads.insertLead({
      full_name, email, phone, firm_name: null, source: input.source, status: "new", notes: null, tags: input.tag ? [input.tag] : [],
      last_contacted_at: null, audit_id: null, audit_score: null, wisp_plan_id: null, customer_id: null, order_id: null, organization_id: null, converted_at: null,
    });
  } catch (e) {
    // The same person arriving twice at once: the second one joins the first.
    const again = await deps.leads.findByEmail(email);
    if (!again) throw e;
    return { email, matches: [{ kind: "lead", id: again.id }], created: null };
  }
  await deps.leads.addEvent({ lead_id: created.id, action: "created", detail: { source: input.source }, actor_id: null });
  return { email, matches: [], created: { kind: "lead", id: created.id } };
}
