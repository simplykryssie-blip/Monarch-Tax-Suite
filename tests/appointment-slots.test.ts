import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_WEEK, type BusinessCalendar } from "../lib/calendar/business.ts";
import { availableSlots, slotIsOffered, windowsFor, type Rule, type SlotType } from "../lib/appointments/slots.ts";

const cal = (over: Partial<BusinessCalendar> = {}): BusinessCalendar => ({ timeZone: "America/New_York", week: DEFAULT_WEEK, closures: [], ...over });
const type = (over: Partial<SlotType> = {}): SlotType => ({ duration_minutes: 60, buffer_before_minutes: 0, buffer_after_minutes: 0, step_minutes: 60, min_notice_minutes: 0, max_days_ahead: 90, ...over });
const weekly = (weekday: number, start: string, end: string): Rule => ({ weekday, on_date: null, closed: false, start_time: start, end_time: end });
const dated = (on_date: string, start: string | null = null, end: string | null = null): Rule => ({ weekday: null, on_date, closed: start === null, start_time: start, end_time: end });
const NOW = new Date("2026-10-12T00:00:00Z"); // a Sunday evening in New York
const local = (d: Date, tz = "America/New_York") => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);

test("with no rules the business hours are used: Monday 9 to 5 gives eight one-hour slots", () => {
  const s = availableSlots(cal(), [], type(), [], NOW, "2026-10-12", 1);
  assert.equal(s.length, 8);
  assert.equal(local(s[0].start), "09:00");
  assert.equal(local(s[7].start), "16:00");
});

test("weekends are closed under the default hours", () => {
  assert.equal(availableSlots(cal(), [], type(), [], NOW, "2026-10-17", 2).length, 0);
});

test("weekly rules replace the business hours, and a day with none is closed", () => {
  const rules = [weekly(2, "10:00", "12:00"), weekly(2, "13:00", "15:00")];
  const s = availableSlots(cal(), rules, type(), [], NOW, "2026-10-12", 3);
  assert.deepEqual(s.map((x) => `${x.date} ${local(x.start)}`), ["2026-10-13 10:00", "2026-10-13 11:00", "2026-10-13 13:00", "2026-10-13 14:00"]);
});

test("a closure blocks the day, but a date row overrides it", () => {
  const holiday = cal({ closures: [{ start: "2026-10-12", end: "2026-10-12", enabled: true }] });
  assert.equal(availableSlots(holiday, [], type(), [], NOW, "2026-10-12", 1).length, 0);
  const opened = availableSlots(holiday, [dated("2026-10-12", "10:00", "12:00"), weekly(1, "09:00", "17:00")], type(), [], NOW, "2026-10-12", 1);
  assert.equal(opened.length, 2);
  const off = cal({ closures: [{ start: "2026-10-12", end: "2026-10-12", enabled: false }] });
  assert.equal(availableSlots(off, [], type(), [], NOW, "2026-10-12", 1).length, 8);
});

test("a closed date row removes a normal day", () => {
  assert.equal(availableSlots(cal(), [dated("2026-10-12")], type(), [], NOW, "2026-10-12", 1).length, 0);
});

test("existing bookings and their buffers block neighbouring slots", () => {
  const busy = [{ start: new Date("2026-10-12T14:00:00Z"), end: new Date("2026-10-12T15:00:00Z") }]; // 10:00-11:00 New York
  const plain = availableSlots(cal(), [], type(), busy, NOW, "2026-10-12", 1).map((s) => local(s.start));
  assert.ok(!plain.includes("10:00") && plain.includes("09:00") && plain.includes("11:00"));
  const buffered = availableSlots(cal(), [], type({ buffer_before_minutes: 15, buffer_after_minutes: 15 }), busy, NOW, "2026-10-12", 1).map((s) => local(s.start));
  assert.ok(!buffered.includes("09:00") && !buffered.includes("11:00") && buffered.includes("12:00"));
});

test("minimum notice and how-far-ahead limits apply", () => {
  const now = new Date("2026-10-12T13:30:00Z"); // 9:30 in New York
  const s = availableSlots(cal(), [], type({ min_notice_minutes: 120 }), [], now, "2026-10-12", 1).map((x) => local(x.start));
  assert.equal(s[0], "12:00");
  assert.equal(availableSlots(cal(), [], type({ max_days_ahead: 1 }), [], NOW, "2026-10-12", 5).filter((x) => x.date > "2026-10-13").length, 0);
});

test("slots keep the office's wall-clock times across the November clock change", () => {
  const s = availableSlots(cal(), [], type(), [], new Date("2026-10-30T00:00:00Z"), "2026-11-02", 1);
  assert.equal(local(s[0].start), "09:00");
  assert.equal(s[0].start.toISOString(), "2026-11-02T14:00:00.000Z"); // EST, after the change
  const before = availableSlots(cal(), [], type(), [], new Date("2026-10-30T00:00:00Z"), "2026-10-30", 1);
  assert.equal(before[0].start.toISOString(), "2026-10-30T13:00:00.000Z"); // EDT
});

test("a slot must fit inside the window and respects the step", () => {
  const s = availableSlots(cal(), [weekly(1, "09:00", "10:30")], type({ duration_minutes: 45, step_minutes: 15 }), [], NOW, "2026-10-12", 1).map((x) => local(x.start));
  assert.deepEqual(s, ["09:00", "09:15", "09:30", "09:45"]);
});

test("slotIsOffered accepts a free offered time and refuses taken or invented ones", () => {
  const start = new Date("2026-10-12T14:00:00Z");
  assert.ok(slotIsOffered(cal(), [], type(), [], NOW, start));
  assert.equal(slotIsOffered(cal(), [], type(), [{ start, end: new Date(start.getTime() + 3_600_000) }], NOW, start), null);
  assert.equal(slotIsOffered(cal(), [], type(), [], NOW, new Date("2026-10-12T14:07:00Z")), null);
  assert.equal(slotIsOffered(cal(), [], type(), [], NOW, new Date("2026-10-12T03:00:00Z")), null);
});

test("windowsFor reads HH:MM:SS from the database", () => {
  assert.deepEqual(windowsFor(cal(), [weekly(1, "09:00:00", "12:30:00")], { y: 2026, m: 10, d: 12 }), [[540, 750]]);
});
