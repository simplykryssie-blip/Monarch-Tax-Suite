import type { SmsAccount } from "./types.ts";

// The monthly number renewal, decided as a pure function so the whole policy is testable:
//   due date: the month's fee is taken from credits.
//   can't be taken: texting is paused and the office is told (attempt 1).
//   3 days later: tried again (attempt 2). 7 days later: tried a last time (attempt 3).
//   still not paid after the last try: the number is released.
//   30 days after the due date with no renewal: the remaining credits are forfeited.

export const RETRY_DAYS = [3, 7] as const;
export const FORFEIT_DAYS = 30;
const DAY = 86_400_000;

export type RenewalStep =
  | { do: "none" }
  | { do: "charge"; attempt: 1 | 2 | 3; period: string }
  | { do: "forfeit"; period: string };

const days = (from: string, now: Date) => (now.getTime() - Date.parse(from)) / DAY;

/** The renewal period a due date starts, for example "2026-11-16". One charge per period. */
export const periodOf = (renewsOn: string) => renewsOn.slice(0, 10);

/** One month after a day, clamped to the month's last day (Jan 31 -> Feb 28). */
export function addMonth(day: string): string {
  const [y, m, d] = day.slice(0, 10).split("-").map(Number);
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, last))).toISOString().slice(0, 10);
}

export function renewalStep(a: Pick<SmsAccount, "status" | "renews_on" | "renewal_failed_at" | "renewal_attempts" | "forfeited_at" | "from_number">, now: Date): RenewalStep {
  if (!a.renews_on) return { do: "none" };
  const period = periodOf(a.renews_on);
  const sinceDue = days(`${a.renews_on.slice(0, 10)}T00:00:00Z`, now);
  if (sinceDue < 0) return { do: "none" };
  if (a.status === "released") return !a.forfeited_at && sinceDue >= FORFEIT_DAYS ? { do: "forfeit", period } : { do: "none" };
  if (a.status !== "active" && a.status !== "paused") return { do: "none" };
  if (!a.renewal_failed_at) return { do: "charge", attempt: 1, period };
  const sinceFail = days(a.renewal_failed_at, now);
  if (a.renewal_attempts <= 1 && sinceFail >= RETRY_DAYS[0]) return { do: "charge", attempt: 2, period };
  if (a.renewal_attempts === 2 && sinceFail >= RETRY_DAYS[1]) return { do: "charge", attempt: 3, period };
  return { do: "none" };
}
