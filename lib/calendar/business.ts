// The office's business calendar: weekly open hours, closed days (federal holidays and the office's own), and a time
// zone. One function, shiftBusinessTime, answers "what moment is 2 business hours / 1 business day after (or before)
// this?" for wait steps, appointment reminders and date triggers; "calendar" mode ignores the calendar entirely.
// Pure: no database, no clock, so every edge (weekends, closed days, closing time, daylight-saving changes) is tested.

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday
export type DayHours = { open: string; close: string }; // "HH:MM", 24-hour, local, open < close
export type Week = Record<Weekday, DayHours | null>; // null = closed all day
export type Closure = { start: string; end: string; enabled: boolean }; // "YYYY-MM-DD", inclusive
export type BusinessCalendar = { timeZone: string; week: Week; closures: Closure[] };

export type Unit = "minutes" | "hours" | "days";
export type Mode = "business" | "calendar";
export type Duration = { amount: number; unit: Unit; mode: Mode };

export const DEFAULT_WEEK: Week = {
  0: null, 1: { open: "09:00", close: "17:00" }, 2: { open: "09:00", close: "17:00" }, 3: { open: "09:00", close: "17:00" },
  4: { open: "09:00", close: "17:00" }, 5: { open: "09:00", close: "17:00" }, 6: null,
};
export const DEFAULT_TIME_ZONE = "America/New_York";

const MIN = 60_000;
const MAX_DAYS_SCANNED = 3700; // about ten years: a calendar with every day closed fails instead of looping

// ---------------------------------------------------------------- time zones

type Parts = { y: number; m: number; d: number; h: number; min: number; dow: Weekday };
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short" });
    formatters.set(tz, f);
  }
  return f;
}
const DOW: Record<string, Weekday> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** The wall-clock reading of an instant in a time zone. */
export function partsIn(at: Date, tz: string): Parts {
  const o: Record<string, string> = {};
  for (const p of formatter(tz).formatToParts(at)) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour, min: +o.minute, dow: DOW[o.weekday] };
}

/** Minutes the zone is ahead of UTC at an instant. */
function offsetMinutes(at: Date, tz: string): number {
  const p = partsIn(at, tz);
  return Math.round((Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - Math.floor(at.getTime() / MIN) * MIN) / MIN);
}

/**
 * The instant at which a zone's clock reads the given local date and time. A time that doesn't exist (the hour that is
 * skipped when clocks go forward) becomes the same wall-clock time after the change; a time that happens twice (clocks
 * go back) is the first one.
 */
export function zonedToUtc(y: number, m: number, d: number, h: number, min: number, tz: string): Date {
  const wall = Date.UTC(y, m - 1, d, h, min);
  let guess = wall - offsetMinutes(new Date(wall), tz) * MIN;
  const second = wall - offsetMinutes(new Date(guess), tz) * MIN;
  if (second !== guess) {
    // The offset differs between the two readings: we are next to a change. Prefer the earlier valid instant.
    const candidates = [guess, second].filter((c) => { const p = partsIn(new Date(c), tz); return p.y === y && p.m === m && p.d === d && p.h === h && p.min === min; });
    guess = candidates.length ? Math.min(...candidates) : Math.max(guess, second);
  }
  return new Date(guess);
}

// ---------------------------------------------------------------- days

export type YMD = { y: number; m: number; d: number };
export const ymdString = (v: YMD) => `${String(v.y).padStart(4, "0")}-${String(v.m).padStart(2, "0")}-${String(v.d).padStart(2, "0")}`;
export function parseYmd(s: string): YMD | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const v = { y: +m[1], m: +m[2], d: +m[3] };
  const t = new Date(Date.UTC(v.y, v.m - 1, v.d));
  return t.getUTCFullYear() === v.y && t.getUTCMonth() === v.m - 1 && t.getUTCDate() === v.d ? v : null;
}
export function addDays(v: YMD, n: number): YMD {
  const t = new Date(Date.UTC(v.y, v.m - 1, v.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}
export const weekdayOf = (v: YMD): Weekday => new Date(Date.UTC(v.y, v.m - 1, v.d)).getUTCDay() as Weekday;
const toMinutes = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const atLocal = (v: YMD, minutes: number, tz: string) => zonedToUtc(v.y, v.m, v.d, Math.floor(minutes / 60), minutes % 60, tz);

/** Whether the office is closed all day on a date: a closed weekday, or inside a switched-on closure. */
export function isClosedDay(cal: BusinessCalendar, v: YMD): boolean {
  if (!cal.week[weekdayOf(v)]) return true;
  const s = ymdString(v);
  return cal.closures.some((c) => c.enabled && c.start <= s && s <= c.end);
}
/** The open window of a date, as minutes since local midnight, or null when closed. */
function windowOf(cal: BusinessCalendar, v: YMD): [number, number] | null {
  if (isClosedDay(cal, v)) return null;
  const h = cal.week[weekdayOf(v)]!;
  return [toMinutes(h.open), toMinutes(h.close)];
}

// ---------------------------------------------------------------- shifting time

/**
 * `from` moved forward (`dir` 1) or back (`dir` -1) by the duration.
 * - Calendar mode: minutes and hours are elapsed time; days keep the same local time of day (across clock changes).
 * - Business minutes/hours: only open time counts. Forward from outside opening hours starts at the next opening;
 *   back from outside starts at the previous closing.
 * - Business days: open days are counted (the start day is not); the result keeps the local time of day, moved into
 *   that day's open hours (before opening becomes opening, after closing becomes closing).
 */
export function shiftBusinessTime(cal: BusinessCalendar, from: Date, d: Duration, dir: 1 | -1 = 1): Date {
  if (!Number.isFinite(d.amount) || d.amount < 0) throw new Error("A wait must be zero or more.");
  const tz = cal.timeZone;
  if (d.mode === "calendar") {
    if (d.unit === "days") {
      const p = partsIn(from, tz);
      const day = addDays({ y: p.y, m: p.m, d: p.d }, dir * d.amount);
      return atLocal(day, p.h * 60 + p.min, tz);
    }
    return new Date(from.getTime() + dir * d.amount * (d.unit === "hours" ? 60 : 1) * MIN);
  }
  return d.unit === "days" ? shiftBusinessDays(cal, from, d.amount, dir) : shiftBusinessMinutes(cal, from, d.amount * (d.unit === "hours" ? 60 : 1), dir);
}

function shiftBusinessDays(cal: BusinessCalendar, from: Date, n: number, dir: 1 | -1): Date {
  const tz = cal.timeZone;
  const p = partsIn(from, tz);
  const tod = p.h * 60 + p.min;
  let day: YMD = { y: p.y, m: p.m, d: p.d };
  let left = Math.round(n);
  for (let scanned = 0; left > 0; scanned++) {
    if (scanned > MAX_DAYS_SCANNED) throw new Error("The business calendar has no open days.");
    day = addDays(day, dir);
    if (!isClosedDay(cal, day)) left--;
  }
  if (n === 0) return from;
  const w = windowOf(cal, day)!;
  return atLocal(day, Math.min(Math.max(tod, w[0]), w[1]), tz);
}

function shiftBusinessMinutes(cal: BusinessCalendar, from: Date, minutes: number, dir: 1 | -1): Date {
  const tz = cal.timeZone;
  let remaining = Math.round(minutes);
  if (remaining === 0) return from;
  const p0 = partsIn(from, tz);
  let day: YMD = { y: p0.y, m: p0.m, d: p0.d };
  let cursor = p0.h * 60 + p0.min; // minutes since local midnight on `day`
  for (let scanned = 0; scanned <= MAX_DAYS_SCANNED; scanned++) {
    const w = windowOf(cal, day);
    if (w) {
      if (dir === 1) {
        const start = Math.max(cursor, w[0]);
        const room = w[1] - start;
        if (room > 0) {
          if (remaining <= room) return atLocal(day, start + remaining, tz);
          remaining -= room;
        }
      } else {
        const end = Math.min(cursor, w[1]);
        const room = end - w[0];
        if (room > 0) {
          if (remaining <= room) return atLocal(day, end - remaining, tz);
          remaining -= room;
        }
      }
    }
    day = addDays(day, dir);
    cursor = dir === 1 ? 0 : 24 * 60;
  }
  throw new Error("The business calendar has no open time.");
}

/** Whether an instant falls inside open hours. */
export function isOpenAt(cal: BusinessCalendar, at: Date): boolean {
  const p = partsIn(at, cal.timeZone);
  const w = windowOf(cal, { y: p.y, m: p.m, d: p.d });
  const t = p.h * 60 + p.min;
  return !!w && t >= w[0] && t < w[1];
}

// ---------------------------------------------------------------- US federal holidays

export type Holiday = { key: string; name: string; date: string };

const nthWeekday = (year: number, month: number, dow: Weekday, n: number): YMD => {
  const first = weekdayOf({ y: year, m: month, d: 1 });
  return { y: year, m: month, d: 1 + ((dow - first + 7) % 7) + (n - 1) * 7 };
};
const lastWeekday = (year: number, month: number, dow: Weekday): YMD => {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = weekdayOf({ y: year, m: month, d: lastDay });
  return { y: year, m: month, d: lastDay - ((last - dow + 7) % 7) };
};
/** A holiday on a Saturday is observed the Friday before; on a Sunday, the Monday after. */
const observed = (v: YMD): YMD => { const w = weekdayOf(v); return w === 6 ? addDays(v, -1) : w === 0 ? addDays(v, 1) : v; };

/** The eleven US federal holidays of a year, on the days they are observed. */
export function federalHolidays(year: number): Holiday[] {
  const fixed = (m: number, d: number): YMD => observed({ y: year, m, d });
  const list: [string, string, YMD][] = [
    ["new_years_day", "New Year's Day", fixed(1, 1)],
    ["mlk_day", "Martin Luther King Jr. Day", nthWeekday(year, 1, 1, 3)],
    ["presidents_day", "Washington's Birthday", nthWeekday(year, 2, 1, 3)],
    ["memorial_day", "Memorial Day", lastWeekday(year, 5, 1)],
    ["juneteenth", "Juneteenth", fixed(6, 19)],
    ["independence_day", "Independence Day", fixed(7, 4)],
    ["labor_day", "Labor Day", nthWeekday(year, 9, 1, 1)],
    ["columbus_day", "Columbus Day", nthWeekday(year, 10, 1, 2)],
    ["veterans_day", "Veterans Day", fixed(11, 11)],
    ["thanksgiving", "Thanksgiving Day", nthWeekday(year, 11, 4, 4)],
    ["christmas", "Christmas Day", fixed(12, 25)],
  ];
  return list.map(([key, name, v]) => ({ key, name, date: ymdString(v) }));
}

// ---------------------------------------------------------------- checking what the office types

export class BusinessInputError extends Error {}
const fail = (m: string): never => { throw new BusinessInputError(m); };

export function isTimeZone(tz: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return tz.length > 0 && tz.length <= 64; } catch { return false; }
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
/** The weekly hours from the form: for each day, either closed or "HH:MM" to "HH:MM". */
export function checkWeek(raw: unknown): Week {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = {} as Week;
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  for (let i = 0; i < 7; i++) {
    const v = r[i] as { open?: unknown; close?: unknown } | null | undefined;
    if (!v || v.open === "" || v.open == null) { out[i as Weekday] = null; continue; }
    const open = String(v.open), close = String(v.close ?? "");
    if (!HHMM.test(open) || !HHMM.test(close)) fail(`${names[i]}: enter the opening and closing times, like 09:00 and 17:00.`);
    if (toMinutes(open) >= toMinutes(close)) fail(`${names[i]}: closing time must be after opening time.`);
    out[i as Weekday] = { open, close };
  }
  if (!Object.values(out).some(Boolean)) fail("The office has to be open at least one day a week.");
  return out;
}

export const CLOSURE_MAX_DAYS = 62;
export function checkClosure(raw: { name?: unknown; start?: unknown; end?: unknown }): { name: string; start: string; end: string } {
  const name = String(raw.name ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!name) fail("Give the closure a name.");
  const start = parseYmd(String(raw.start ?? ""));
  const end = parseYmd(String(raw.end || raw.start || ""));
  if (!start || !end) return fail("Enter the dates as year-month-day.");
  if (ymdString(end) < ymdString(start)) fail("The last day can't be before the first day.");
  const days = (Date.UTC(end.y, end.m - 1, end.d) - Date.UTC(start.y, start.m - 1, start.d)) / 86_400_000 + 1;
  if (days > CLOSURE_MAX_DAYS) fail(`A closure can be at most ${CLOSURE_MAX_DAYS} days.`);
  if (start.y < 2000 || end.y > 2100) fail("Choose dates between 2000 and 2100.");
  return { name, start: ymdString(start), end: ymdString(end) };
}
