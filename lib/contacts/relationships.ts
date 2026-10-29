import { ValidationError } from "../commerce/validation.ts";
import type { LeadsRepo } from "../leads/types.ts";
import type { WorkspaceRepo } from "../workspace/types.ts";

// Family relationships between people. One row says "A is B's <kind>". Each person is a client or a lead. Both people see it:
// on B's page it reads with the kind as given ("Son: A"), on A's page with its other side ("Parent: B").

export const REL_KINDS = {
  spouse: "Spouse or partner", parent: "Parent", son: "Son", daughter: "Daughter", grandchild: "Grandchild", grandparent: "Grandparent",
  aunt: "Aunt", uncle: "Uncle", sibling: "Sibling", other: "Other",
} as const;
export type RelKind = keyof typeof REL_KINDS;

/** How A reads from B's side: B is A's ... (A is B's parent, so B is A's child). */
export const REL_OTHER_SIDE: Record<RelKind, string> = {
  spouse: "Spouse or partner", parent: "Child", son: "Parent", daughter: "Parent", grandchild: "Grandparent", grandparent: "Grandchild",
  aunt: "Niece or nephew", uncle: "Niece or nephew", sibling: "Sibling", other: "Other",
};

/** Kinds that mean the same connection seen from the other person. Used so one connection can't be entered twice. */
const MIRROR: Record<RelKind, RelKind[]> = {
  spouse: ["spouse"], sibling: ["sibling"], other: ["other"], parent: ["son", "daughter"], son: ["parent"], daughter: ["parent"],
  grandparent: ["grandchild"], grandchild: ["grandparent"], aunt: [], uncle: [],
};

export type PersonRef = { kind: "client" | "lead"; id: string };
export type Relationship = { id: string; a: PersonRef; b: PersonRef; kind: RelKind; note: string | null; created_at: string };

export type RelationshipsRepo = {
  /** Every relationship this person is on either side of. */
  listFor(p: PersonRef): Promise<Relationship[]>;
  get(id: string): Promise<Relationship | null>;
  add(a: PersonRef, b: PersonRef, kind: RelKind, note: string | null, actorId: string | null): Promise<Relationship>;
  remove(id: string): Promise<void>;
};
export type RelationshipsDeps = { rels: RelationshipsRepo; clients: WorkspaceRepo; leads: LeadsRepo };

const samePerson = (x: PersonRef, y: PersonRef) => x.kind === y.kind && x.id === y.id;

/** A person's name, wherever they are kept. */
export async function nameOf(d: RelationshipsDeps, p: PersonRef): Promise<string | null> {
  if (p.kind === "client") return (await d.clients.getClient(p.id))?.full_name ?? null;
  return (await d.leads.getLead(p.id))?.full_name ?? null;
}

export type RelationshipView = { id: string; label: string; note: string | null; other: PersonRef; otherName: string };

/** The relationships on a person's page, each from their own side, with the other person's name. */
export async function relationshipsFor(d: RelationshipsDeps, me: PersonRef): Promise<RelationshipView[]> {
  const rows = await d.rels.listFor(me);
  const out: RelationshipView[] = [];
  for (const r of rows) {
    const iAmB = samePerson(r.b, me);
    const other = iAmB ? r.a : r.b;
    const otherName = await nameOf(d, other);
    if (!otherName) continue;
    out.push({ id: r.id, label: iAmB ? REL_KINDS[r.kind] : REL_OTHER_SIDE[r.kind], note: r.note, other, otherName });
  }
  return out;
}

/**
 * Adds "<other> is <me>'s <kind>". The person must not be linked to themselves, the same connection can't be entered twice (even
 * from the other side), and a spouse already linked in the client's Spouse section is not entered a second time here.
 */
export async function addRelationship(d: RelationshipsDeps, me: PersonRef, other: PersonRef, kindRaw: unknown, noteRaw: unknown, actorId: string | null): Promise<Relationship> {
  const kind = typeof kindRaw === "string" && kindRaw in REL_KINDS ? (kindRaw as RelKind) : null;
  if (!kind) throw new ValidationError("Choose how they are related.");
  if (samePerson(me, other)) throw new ValidationError("Choose someone else.");
  const note = typeof noteRaw === "string" ? noteRaw.replace(/\s+/g, " ").trim().slice(0, 200) : "";
  if (kind === "other" && !note) throw new ValidationError("Add a short note saying how they are related.");
  const otherName = await nameOf(d, other);
  if (!otherName) throw new ValidationError("That person wasn't found.");
  if (!(await nameOf(d, me))) throw new ValidationError("That person wasn't found.");
  if (kind === "spouse") {
    for (const p of [me, other]) {
      if (p.kind !== "client") continue;
      const c = await d.clients.getClient(p.id);
      const partner = p.id === me.id ? other : me;
      if (c?.spouse_id && (partner.kind !== "client" || partner.id !== c.spouse_id)) throw new ValidationError(`${c.full_name} already has a spouse linked in their Spouse section.`);
      if (c?.spouse_id && partner.kind === "client" && partner.id === c.spouse_id) throw new ValidationError("They are already linked as spouses in the Spouse section.");
      if (c && !c.spouse_id && (await d.clients.getSpouse(p.id))) throw new ValidationError(`${c.full_name} already has a spouse recorded in their Spouse section.`);
    }
  }
  // other is me's <kind>: a = other, b = me.
  const existing = await d.rels.listFor(me);
  const dup = existing.some((r) => (samePerson(r.a, other) && samePerson(r.b, me) && r.kind === kind) || (samePerson(r.a, me) && samePerson(r.b, other) && MIRROR[kind].includes(r.kind)));
  if (dup) throw new ValidationError(`${otherName} is already entered as ${REL_KINDS[kind].toLowerCase()}.`);
  if (existing.length >= 40) throw new ValidationError("That is the most relationships one person can hold.");
  const saved = await d.rels.add(other, me, kind, note || null, actorId);
  const myName = (await nameOf(d, me)) ?? "";
  await record(d, me, "relationship.added", `${REL_KINDS[kind]}: ${otherName}`, actorId);
  await record(d, other, "relationship.added", `${REL_OTHER_SIDE[kind]}: ${myName}`, actorId);
  return saved;
}

async function record(d: RelationshipsDeps, p: PersonRef, action: string, text: string, actorId: string | null) {
  try {
    if (p.kind === "client") await d.clients.addClientEvent({ clientId: p.id, action, actorId, detail: { name: text } });
    else await d.leads.addEvent({ lead_id: p.id, action, detail: { name: text }, actor_id: actorId });
  } catch { /* the relationship is saved; its note is a courtesy */ }
}

export async function removeRelationship(d: RelationshipsDeps, me: PersonRef, id: string, actorId: string | null = null): Promise<void> {
  const r = await d.rels.get(id);
  if (!r || !(samePerson(r.a, me) || samePerson(r.b, me))) throw new ValidationError("That relationship wasn't found.");
  await d.rels.remove(r.id);
  const aName = (await nameOf(d, r.a)) ?? "";
  const bName = (await nameOf(d, r.b)) ?? "";
  await record(d, r.b, "relationship.removed", `${REL_KINDS[r.kind]}: ${aName}`, actorId);
  await record(d, r.a, "relationship.removed", `${REL_OTHER_SIDE[r.kind]}: ${bName}`, actorId);
}
