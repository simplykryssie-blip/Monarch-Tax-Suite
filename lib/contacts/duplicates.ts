import type { Contact, PossibleDuplicate } from "./combine.ts";
import { DUPLICATE_REASON } from "./combine.ts";

export type DuplicateOf = { other: Contact; reason: string };

/** The other contacts that may be the same person as the one with this client record, and why. */
export function duplicatesOfClient(contacts: Contact[], pairs: PossibleDuplicate[], clientId: string): DuplicateOf[] {
  const mine = contacts.find((c) => c.refs.clientId === clientId);
  if (!mine) return [];
  const byKey = new Map(contacts.map((c) => [c.key, c]));
  const out: DuplicateOf[] = [];
  for (const d of pairs) {
    if (d.a !== mine.key && d.b !== mine.key) continue;
    const other = byKey.get(d.a === mine.key ? d.b : d.a);
    if (other) out.push({ other, reason: DUPLICATE_REASON[d.reason] });
  }
  return out;
}
