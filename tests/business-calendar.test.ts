import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  BusinessInputError, checkClosure, checkWeek, DEFAULT_WEEK, federalHolidays, isClosedDay, isOpenAt, isTimeZone, parseYmd, shiftBusinessTime, zonedToUtc,
  type BusinessCalendar, type Closure, type Duration,
} from "../lib/calendar/business.ts";

// The business calendar: "2 business hours" and "1 business day" before or after a moment, around weekends, closed
// days, closing time and clock changes. Offices are in New York time here (EDT is UTC-4, EST is UTC-5).

const cal = (closures: Closure[] = [], over: Partial<BusinessCalendar> = {}): BusinessCalendar => ({ timeZone: "America/New_York", week: DEFAULT_WEEK, closures, ...over });
const at = (iso: string) => new Date(iso);
const d = (amount: number, unit: Duration["unit"], mode: Duration["mode"]): Duration => ({ amount, unit, mode });
const iso = (x: Date) => x.toISOString();

describe("US federal holidays", () => {
  test("2026: eleven days, with weekend holidays observed on the Friday or Monday", () => {
    const h = Object.fromEntries(federalHolidays(2026).map((x) => [x.key, x.date]));
    assert.equal(Object.keys(h).length, 11);
    assert.deepEqual(h, {
      new_years_day: "2026-01-01", mlk_day: "2026-01-19", presidents_day: "2026-02-16", memorial_day: "2026-05-25", juneteenth: "2026-06-19",
      independence_day: "2026-07-03", labor_day: "2026-09-07", columbus_day: "2026-10-12", veterans_day: "2026-11-11", thanksgiving: "2026-11-26", christmas: "2026-12-25",
    });
  });
  test("a Sunday holiday moves to the Monday; a Saturday one to the Friday, even into the year before", () => {
    const h27 = Object.fromEntries(federalHolidays(2027).map((x) => [x.key, x.date]));
    assert.equal(h27.independence_day, "2027-07-05"); // Sunday
    assert.equal(h27.christmas, "2027-12-24"); // Saturday
    assert.equal(federalHolidays(2028).find((x) => x.key === "new_years_day")!.date, "2027-12-31"); // 1 Jan 2028 is a Saturday
  });
});

describe("time zones", () => {
  test("a local time becomes the right instant, in summer and winter", () => {
    assert.equal(iso(zonedToUtc(2026, 7, 1, 9, 0, "America/New_York")), "2026-07-01T13:00:00.000Z");
    assert.equal(iso(zonedToUtc(2026, 12, 1, 9, 0, "America/New_York")), "2026-12-01T14:00:00.000Z");
  });
  test("a time that clocks skip becomes the same hour after the change; a repeated time is the first one", () => {
    assert.equal(iso(zonedToUtc(2026, 3, 8, 2, 30, "America/New_York")), "2026-03-08T07:30:00.000Z");
    assert.equal(iso(zonedToUtc(2026, 11, 1, 1, 30, "America/New_York")), "2026-11-01T05:30:00.000Z");
  });
  test("zones are validated", () => {
    assert.equal(isTimeZone("America/Chicago"), true);
    assert.equal(isTimeZone("Mars/Olympus"), false);
    assert.equal(isTimeZone(""), false);
  });
});

describe("open and closed", () => {
  test("weekends and switched-on closures are closed; switched-off closures are not", () => {
    const c = cal([{ start: "2026-12-23", end: "2026-12-26", enabled: true }, { start: "2026-10-20", end: "2026-10-20", enabled: false }]);
    assert.equal(isClosedDay(c, parseYmd("2026-10-17")!), true); // Saturday
    assert.equal(isClosedDay(c, parseYmd("2026-12-24")!), true);
    assert.equal(isClosedDay(c, parseYmd("2026-12-28")!), false);
    assert.equal(isClosedDay(c, parseYmd("2026-10-20")!), false);
  });
  test("open hours are open at the opening minute and closed at the closing minute", () => {
    assert.equal(isOpenAt(cal(), at("2026-10-19T13:00:00Z")), true); // Mon 09:00 EDT
    assert.equal(isOpenAt(cal(), at("2026-10-19T20:59:00Z")), true); // 16:59
    assert.equal(isOpenAt(cal(), at("2026-10-19T21:00:00Z")), false); // 17:00
  });
});

describe("business hours", () => {
  test("2 business hours from Friday 16:00 end Monday 10:00", () => {
    assert.equal(iso(shiftBusinessTime(cal(), at("2026-10-16T20:00:00Z"), d(2, "hours", "business"))), "2026-10-19T14:00:00.000Z");
  });
  test("going back: 2 business hours before Monday 10:00 is Friday 16:00", () => {
    assert.equal(iso(shiftBusinessTime(cal(), at("2026-10-19T14:00:00Z"), d(2, "hours", "business"), -1)), "2026-10-16T20:00:00.000Z");
  });
  test("from a Saturday the clock starts at Monday's opening", () => {
    assert.equal(iso(shiftBusinessTime(cal(), at("2026-10-17T16:00:00Z"), d(1, "hours", "business"))), "2026-10-19T14:00:00.000Z");
  });
  test("a closed Monday pushes it to Tuesday, and minutes work the same way", () => {
    const c = cal([{ start: "2026-10-19", end: "2026-10-19", enabled: true }]);
    assert.equal(iso(shiftBusinessTime(c, at("2026-10-16T20:00:00Z"), d(90, "minutes", "business"))), "2026-10-20T13:30:00.000Z"); // 60 left Fri then 30 Tue
  });
  test("a long closure (Dec 23 to 26) is skipped", () => {
    const c = cal([{ start: "2026-12-23", end: "2026-12-26", enabled: true }]);
    // Tue Dec 22 16:00 + 2 hours: 1h Tuesday, then Monday Dec 28 09:00 + 1h
    assert.equal(iso(shiftBusinessTime(c, at("2026-12-22T21:00:00Z"), d(2, "hours", "business"))), "2026-12-28T15:00:00.000Z");
  });
  test("an exact fit ends at closing time, not the next morning", () => {
    assert.equal(iso(shiftBusinessTime(cal(), at("2026-10-19T13:00:00Z"), d(8, "hours", "business"))), "2026-10-19T21:00:00.000Z");
  });
  test("zero is the same moment", () => {
    const t = at("2026-10-17T16:00:00Z");
    assert.equal(shiftBusinessTime(cal(), t, d(0, "hours", "business")), t);
  });
  test("different hours on different days", () => {
    const week = { ...DEFAULT_WEEK, 5: { open: "09:00", close: "12:00" } } as BusinessCalendar["week"];
    // Friday closes at noon: from Fri 11:00 +2h = 1h Friday + 1h Monday morning
    assert.equal(iso(shiftBusinessTime(cal([], { week }), at("2026-10-16T15:00:00Z"), d(2, "hours", "business"))), "2026-10-19T14:00:00.000Z");
  });
});

describe("business days", () => {
  test("2 business days from Friday 16:00 is Tuesday 16:00; a closed Monday makes it Wednesday", () => {
    assert.equal(iso(shiftBusinessTime(cal(), at("2026-10-16T20:00:00Z"), d(2, "days", "business"))), "2026-10-20T20:00:00.000Z");
    const c = cal([{ start: "2026-10-19", end: "2026-10-19", enabled: true }]);
    assert.equal(iso(shiftBusinessTime(c, at("2026-10-16T20:00:00Z"), d(2, "days", "business"))), "2026-10-21T20:00:00.000Z");
  });
  test("from a weekend the first business day is Monday", () => {
    assert.equal(iso(shiftBusinessTime(cal(), at("2026-10-17T16:00:00Z"), d(1, "days", "business"))), "2026-10-19T16:00:00.000Z");
  });
  test("a time outside open hours lands inside them", () => {
    // Monday 08:00 (before opening) + 2 business days -> Wednesday 09:00; Monday 18:00 -> Wednesday 17:00
    assert.equal(iso(shiftBusinessTime(cal(), at("2026-10-19T12:00:00Z"), d(2, "days", "business"))), "2026-10-21T13:00:00.000Z");
    assert.equal(iso(shiftBusinessTime(cal(), at("2026-10-19T22:00:00Z"), d(2, "days", "business"))), "2026-10-21T21:00:00.000Z");
  });
  test("going back: 1 business day before Monday 10:00 is Friday 10:00", () => {
    assert.equal(iso(shiftBusinessTime(cal(), at("2026-10-19T14:00:00Z"), d(1, "days", "business"), -1)), "2026-10-16T14:00:00.000Z");
  });
});

describe("calendar mode ignores the calendar", () => {
  test("hours are elapsed hours, over a weekend and a closed day", () => {
    assert.equal(iso(shiftBusinessTime(cal(), at("2026-10-16T20:00:00Z"), d(2, "hours", "calendar"))), "2026-10-16T22:00:00.000Z");
    assert.equal(iso(shiftBusinessTime(cal(), at("2026-10-16T20:00:00Z"), d(30, "minutes", "calendar"), -1)), "2026-10-16T19:30:00.000Z");
  });
  test("days keep the local time of day across a clock change", () => {
    // Sat 31 Oct 09:00 EDT + 1 calendar day = Sun 1 Nov 09:00 EST (14:00Z), not 13:00Z
    assert.equal(iso(shiftBusinessTime(cal(), at("2026-10-31T13:00:00Z"), d(1, "days", "calendar"))), "2026-11-01T14:00:00.000Z");
  });
  test("business hours across the clock change still count open hours", () => {
    // Fri 30 Oct 16:00 EDT + 2 business hours = Mon 2 Nov 10:00 EST (15:00Z)
    assert.equal(iso(shiftBusinessTime(cal(), at("2026-10-30T20:00:00Z"), d(2, "hours", "business"))), "2026-11-02T15:00:00.000Z");
  });
});

describe("failure and input checks", () => {
  test("an amount can't be negative; a calendar that is never open fails instead of looping", () => {
    assert.throws(() => shiftBusinessTime(cal(), new Date(), d(-1, "hours", "business")), /zero or more/);
    const never = cal([{ start: "2000-01-01", end: "2100-12-31", enabled: true }]);
    assert.throws(() => shiftBusinessTime(never, at("2026-10-16T20:00:00Z"), d(1, "hours", "business")), /no open time/);
    assert.throws(() => shiftBusinessTime(never, at("2026-10-16T20:00:00Z"), d(1, "days", "business")), /no open days/);
  });
  test("weekly hours are checked", () => {
    const ok = checkWeek({ 1: { open: "08:30", close: "17:30" }, 2: { open: "", close: "" } });
    assert.deepEqual(ok[1], { open: "08:30", close: "17:30" });
    assert.equal(ok[2], null);
    assert.throws(() => checkWeek({ 1: { open: "09:00", close: "08:00" } }), /after opening/);
    assert.throws(() => checkWeek({ 1: { open: "9am", close: "5pm" } }), /like 09:00/);
    assert.throws(() => checkWeek({}), BusinessInputError);
  });
  test("closures are checked", () => {
    assert.deepEqual(checkClosure({ name: "  Christmas  break ", start: "2026-12-23", end: "2026-12-26" }), { name: "Christmas break", start: "2026-12-23", end: "2026-12-26" });
    assert.deepEqual(checkClosure({ name: "Retreat", start: "2026-11-02" }), { name: "Retreat", start: "2026-11-02", end: "2026-11-02" });
    assert.throws(() => checkClosure({ name: "", start: "2026-11-02" }), /name/);
    assert.throws(() => checkClosure({ name: "x", start: "2026-11-05", end: "2026-11-02" }), /before/);
    assert.throws(() => checkClosure({ name: "x", start: "2026-02-30" }), /year-month-day/);
    assert.throws(() => checkClosure({ name: "x", start: "2026-01-01", end: "2026-06-01" }), /at most/);
  });
});
