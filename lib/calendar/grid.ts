import { addDays, weekdayOf, ymdString, type YMD } from "./business.ts";

/** The first day shown on a month calendar: the Sunday on or before the 1st. A month grid is six whole weeks (42 days). */
export function monthGridStart(anchor: YMD): YMD {
  const first = { y: anchor.y, m: anchor.m, d: 1 };
  return addDays(first, -weekdayOf(first));
}

/** The first of the month `n` months from the anchor's month. */
export function shiftMonth(anchor: YMD, n: number): string {
  const idx = anchor.y * 12 + (anchor.m - 1) + n;
  return ymdString({ y: Math.floor(idx / 12), m: (idx % 12) + 1, d: 1 });
}
