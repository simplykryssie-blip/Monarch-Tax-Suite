import { ValidationError } from "../commerce/validation.ts";
import { ATTACH_MAX_ROWS, planMessagesImport, planNotesImport, type Matchable, type PlannedMessage } from "./attach.ts";
import { IMPORT_MAX_BYTES, planContactImport, SUPPORTS, type ContactImportPlan, type Destination, type ExistingContact, type PlannedContact } from "./contacts.ts";

// Importing from a spreadsheet into one of four places (clients, leads, store customers, firms). A first call shows what
// would happen; a second, with confirm, does it. Three kinds of file: people (with their tags and notes), notes for
// people already there, and messages for people already there. Imported people are NOT marked as having agreed to
// marketing: consent is a separate step in Campaigns. Messages are written down as history only; nothing is sent.

export type ImportKind = "contacts" | "notes" | "messages";
export const KINDS: ImportKind[] = ["contacts", "notes", "messages"];

/** One place people can be imported into. The server wires a real one per destination; tests use a fake. */
export interface ImportTarget {
  destination: Destination;
  /** Everyone already there. "dedupe" is everyone in the account or office, so nobody is added twice; "attach" is the people the person may add notes and messages to. */
  people(purpose: "dedupe" | "attach"): Promise<(Matchable & { name: string | null })[]>;
  /** Adds one person (and their note and tags, where the destination keeps them). Returns the new id. */
  add(p: PlannedContact): Promise<string>;
  addNote?(personId: string, text: string, at: string | null): Promise<void>;
  addMessage?(personId: string, m: PlannedMessage): Promise<void>;
  /** Every tag already in use, so new ones can be told apart. */
  knownTags?(): Promise<string[]>;
}

export type ImportRequest = { kind: ImportKind; csv: string; tag: string; confirm: boolean };
export type ImportSummary = {
  kind: ImportKind; destination: Destination; done: boolean;
  total: number; willAdd: number; added: number; failed: number;
  sample: { name: string; detail: string; tags: string[]; notes: string[] }[];
  skipped: { row: number; reason: string }[];
  columns: { used: string[]; sensitive: string[]; unknown: string[]; unsupported: string[] };
  /** Tags this import brought that were not in use before (created now), and ones that already existed. */
  newTags: string[]; existingTags: string[];
};

/** Support for a kind at a destination, in words, or null when it works. */
export function unsupported(destination: Destination, kind: ImportKind): string | null {
  const can = SUPPORTS[destination];
  if (kind === "notes" && !can.notes) return `${can.label} don't keep notes, so there is nothing to attach them to.`;
  if (kind === "messages" && !can.messages) return `${can.label} don't keep a message history. Messages can be imported into clients.`;
  return null;
}

export async function runImport(target: ImportTarget, input: ImportRequest, record: (detail: Record<string, unknown>) => Promise<void>): Promise<ImportSummary> {
  if (input.csv.length > IMPORT_MAX_BYTES) throw new ValidationError("That file is too big. Split it into files under 2 MB.");
  const problem = unsupported(target.destination, input.kind);
  if (problem) throw new ValidationError(problem);
  const base = { kind: input.kind, destination: target.destination };

  if (input.kind === "contacts") {
    const people = await target.people("dedupe");
    const existing: ExistingContact[] = people.map((p) => ({ email: p.email, phone: p.phone, name: p.name }));
    const plan: ContactImportPlan = planContactImport(input.csv, existing, input.tag ? [input.tag] : [], target.destination);
    const known = new Set((await target.knownTags?.().catch(() => [])) ?? []);
    const incoming = [...new Set(plan.add.flatMap((p) => p.tags))];
    const summary: ImportSummary = {
      ...base, done: false, total: plan.total, willAdd: plan.add.length, added: 0, failed: 0,
      sample: plan.add.slice(0, 8).map((p) => ({ name: p.full_name, detail: [p.email, p.phone].filter(Boolean).join(" · "), tags: p.tags, notes: p.notes })),
      skipped: plan.skipped.slice(0, 50), columns: plan.columns,
      newTags: incoming.filter((t) => !known.has(t)), existingTags: incoming.filter((t) => known.has(t)),
    };
    if (!input.confirm) return summary;
    for (const p of plan.add) {
      try { await target.add(p); summary.added++; } catch { summary.failed++; }
    }
    summary.done = true;
    // The history records how many, never who.
    await record({ kind: "contacts", destination: target.destination, added: summary.added, skipped: plan.skipped.length, failed: summary.failed, rows: plan.total, new_tags: summary.newTags.length });
    return summary;
  }

  const people = await target.people("attach");
  const plan = input.kind === "notes" ? planNotesImport(input.csv, people) : planMessagesImport(input.csv, people);
  const summary: ImportSummary = {
    ...base, done: false, total: plan.total, willAdd: plan.add.length, added: 0, failed: 0,
    sample: plan.add.slice(0, 8).map((p) => ({ name: p.person, detail: "text" in p ? p.text.slice(0, 120) : `${p.direction === "in" ? "From them" : "To them"} · ${p.channel}: ${p.body.slice(0, 100)}`, tags: [], notes: [] })),
    skipped: plan.skipped.slice(0, 50), columns: { ...plan.columns, sensitive: [], unsupported: [] }, newTags: [], existingTags: [],
  };
  if (!input.confirm) return summary;
  for (const p of plan.add) {
    try {
      if ("text" in p) await target.addNote!(p.personId, p.text, p.at);
      else await target.addMessage!(p.personId, p);
      summary.added++;
    } catch { summary.failed++; }
  }
  summary.done = true;
  await record({ kind: input.kind, destination: target.destination, added: summary.added, skipped: plan.skipped.length, failed: summary.failed, rows: plan.total });
  return summary;
}

export { ATTACH_MAX_ROWS };
