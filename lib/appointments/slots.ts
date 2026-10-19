import { addDays, atLocal, inClosure, parseYmd, toMinutes, weekdayOf, ymdString, type BusinessCalendar, type YMD } from "../calendar/business.ts";

// Which times can be booked. Pure: no database, no clock. A time is offered when it falls inside the day's open
// windows, doesn't touch another booking (buffers included), isn't a closed day, and respects the type's notice and
// how-far-ahead limits. Everything is worked out in the office's time zone and returned as UTC instants.

export type Rule = { weekday: number | null; on_date: string | null; closed: boolean; start_time: string | null; end_time: string | null };
export type SlotType = { duration_minutes: number; buffer_before_minutes: number; buffer_after_minutes: number; step_minutes: number; min_notice_minutes: number; max_days_ahead: number };
export type Busy = { start: Date; end: Date };
export type Slot = { start: Date; end: Date; blockStart: Date; blockEnd: Date; date: string };

const MIN = 60_000;
const hhmm = (t: string) => t.slice(0, 5);
const overlaps = (a: Busy, b: Busy) => a.start < b.end && b.start < a.end;

/** The open windows (minutes since local midnight) of one date. A date row wins over the weekly hours and over closures. */
export function windowsFor(cal: BusinessCalendar, rules: Rule[], v: YMD): [number, number][] {
  const day = ymdString(v);
  const dated = rules.filter((r) => r.on_date === day);
  if (dated.length) return dated.some((r) => r.closed) ? [] : dated.map((r) => [toMinutes(hhmm(r.start_time!)), toMinutes(hhmm(r.end_time!))] as [number, number]).sort((a, b) => a[0] - b[0]);
  if (inClosure(cal, v)) return [];
  const weekly = rules.filter((r) => r.weekday !== null);
  if (weekly.length) return weekly.filter((r) => r.weekday === weekdayOf(v)).map((r) => [toMinutes(hhmm(r.start_time!)), toMinutes(hhmm(r.end_time!))] as [number, number]).sort((a, b) => a[0] - b[0]);
  const h = cal.week[weekdayOf(v)];
  return h ? [[toMinutes(h.open), toMinutes(h.close)]] : [];
}

/** The bookable start times from a local date, for a number of days. */
export function availableSlots(cal: BusinessCalendar, rules: Rule[], t: SlotType, busy: Busy[], now: Date, fromDate: string, days: number): Slot[] {
  const first = parseYmd(fromDate);
  if (!first) return [];
  const earliest = now.getTime() + t.min_notice_minutes * MIN;
  const latest = now.getTime() + t.max_days_ahead * 86_400_000;
  const out: Slot[] = [];
  for (let i = 0; i < Math.min(days, 92); i++) {
    const v = addDays(first, i);
    for (const [open, close] of windowsFor(cal, rules, v)) {
      for (let s = open; s + t.duration_minutes <= close; s += t.step_minutes) {
        const start = atLocal(v, s, cal.timeZone);
        if (start.getTime() < earliest || start.getTime() > latest) continue;
        const end = new Date(start.getTime() + t.duration_minutes * MIN);
        const block: Busy = { start: new Date(start.getTime() - t.buffer_before_minutes * MIN), end: new Date(end.getTime() + t.buffer_after_minutes * MIN) };
        if (busy.some((b) => overlaps(b, block))) continue;
        out.push({ start, end, blockStart: block.start, blockEnd: block.end, date: ymdString(v) });
      }
    }
  }
  return out;
}

/** Whether one specific start is still offered (used when someone books or reschedules). */
export function slotIsOffered(cal: BusinessCalendar, rules: Rule[], t: SlotType, busy: Busy[], now: Date, start: Date): Slot | null {
  const local = new Intl.DateTimeFormat("en-CA", { timeZone: cal.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(start);
  const match = availableSlots(cal, rules, t, busy, now, local, 1).find((s) => s.start.getTime() === start.getTime());
  return match ?? null;
}
