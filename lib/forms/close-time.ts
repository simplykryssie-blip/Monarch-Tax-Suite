import { zonedToUtc } from "../calendar/business.ts";

const DEFAULT_ZONE = "America/New_York";

/** A date-and-time box value ("2026-11-05T17:00") typed in the office's own clock, as the instant it means. */
export function closeAtFromOfficeClock(value: string, timeZone: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value.trim());
  if (!m) return value;
  return zonedToUtc(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), timeZone || DEFAULT_ZONE).toISOString();
}

/** A stored close instant as the date-and-time box value on the office's own clock. */
export function closeAtToOfficeClock(iso: string | null, timeZone: string | null | undefined): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || DEFAULT_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
