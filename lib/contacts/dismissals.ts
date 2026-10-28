import type { PossibleDuplicate } from "./combine.ts";

/** A pair of contact keys in a fixed order (smaller first), so the same pair is always the same row. */
export const pairOf = (x: string, y: string): [string, string] => (x < y ? [x, y] : [y, x]);
const idOf = (a: string, b: string) => pairOf(a, b).join("|");

/** The possible duplicates that have not been marked "not a duplicate". */
export function withoutDismissed(pairs: PossibleDuplicate[], dismissed: { key_a: string; key_b: string }[]): PossibleDuplicate[] {
  const gone = new Set(dismissed.map((d) => idOf(d.key_a, d.key_b)));
  return pairs.filter((p) => !gone.has(idOf(p.a, p.b)));
}
