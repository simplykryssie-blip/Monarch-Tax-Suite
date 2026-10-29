import type { Client, ClientEvent } from "./types.ts";

// The record of what staff did on a client's card: who changed which detail, and when. Values are written down only for plain
// contact details (name, email, phone, address); the date of birth, license and Social Security number are named, never copied.

type Tracked = { label: string; keys: (keyof Client)[]; show?: boolean };
const TRACKED: Tracked[] = [
  { label: "name", keys: ["first_name", "last_name"], show: true },
  { label: "email", keys: ["email"], show: true },
  { label: "phone", keys: ["phone"], show: true },
  { label: "date of birth", keys: ["dob"] },
  { label: "address", keys: ["address_line1", "address_line2", "city", "state", "zip", "address"], show: true },
  { label: "last year's address", keys: ["address_same_as_last_year", "prior_address_line1", "prior_address_line2", "prior_city", "prior_state", "prior_zip"] },
  { label: "driver's license", keys: ["dl_number", "dl_state", "dl_issued_on", "dl_expires_on"] },
];

const norm = (v: unknown) => (v === null || v === undefined || v === "" ? "" : String(v));
const shown = (c: Client, t: Tracked) => (t.label === "name" ? [c.first_name, c.last_name].filter(Boolean).join(" ") || c.full_name : t.label === "address" ? c.address ?? "" : norm(c[t.keys[0]]));

export type FieldChange = { field: string; from?: string; to?: string };

/** What changed between two versions of a client, in words. Empty when nothing a person would notice changed. */
export function changedFields(before: Client, after: Client): FieldChange[] {
  const out: FieldChange[] = [];
  for (const t of TRACKED) {
    if (t.keys.every((k) => norm(before[k]) === norm(after[k]))) continue;
    out.push(t.show ? { field: t.label, from: shown(before, t), to: shown(after, t) } : { field: t.label });
  }
  return out;
}

const LABELS: Record<string, string> = {
  "client.created": "Client added",
  "task.edited": "Task edited",
  "task.deleted": "Task deleted",
  "note.edited": "Note edited",
  "note.deleted": "Note deleted",
  "client.tags_changed": "Tags changed",
  "client.assigned": "Assigned to a teammate",
  "client.merged": "Merged another client into this one",
  "client.spouse_linked": "Spouse linked",
  "client.spouse_unlinked": "Spouse unlinked",
  "client.spouse_saved": "Spouse added",
  "client.spouse_removed": "Spouse removed",
  "client.dependent_added": "Dependent added",
  "client.dependent_removed": "Dependent removed",
  "client.business_added": "Business added",
  "client.business_removed": "Business removed",
  "ssn.stored": "Social Security number saved or replaced",
  "ssn.cleared": "Social Security number removed",
  "ssn.revealed": "Social Security number revealed",
  "ssn.reveal_wrong_password": "Social Security number reveal tried with a wrong password",
  "ssn.reveal_refused": "Social Security number reveal refused",
  "ssn.reveal_limited": "Social Security number reveal blocked: too many attempts",
};

/** One sentence for one event. Null for events this list doesn't show. */
export function describeEvent(e: Pick<ClientEvent, "action" | "detail">): string | null {
  if (e.action === "return.updated") {
    const changes = Array.isArray(e.detail.changes) ? (e.detail.changes as unknown[]).filter((c): c is string => typeof c === "string") : [];
    return `${typeof e.detail.label === "string" ? e.detail.label.replace(/^./, (c) => c.toUpperCase()) : "Return"}: ${changes.join("; ") || "edited"}`;
  }
  if (e.action === "return.archived") return `${typeof e.detail.label === "string" ? e.detail.label.replace(/^./, (c) => c.toUpperCase()) : "Return"} archived`;
  if (e.action === "client.updated") {
    const changes = Array.isArray(e.detail.changes) ? (e.detail.changes as FieldChange[]) : [];
    if (!changes.length) return null;
    return `Changed ${changes.map((c) => (c.from !== undefined || c.to !== undefined ? `${c.field} from ${c.from || "blank"} to ${c.to || "blank"}` : c.field)).join(", ")}`;
  }
  const base = LABELS[e.action];
  if (!base) return null;
  const name = typeof e.detail.name === "string" && e.detail.name ? `: ${e.detail.name}` : typeof e.detail.merged_name === "string" ? `: ${e.detail.merged_name}` : "";
  return `${base}${name}`;
}
