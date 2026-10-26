import assert from "node:assert/strict";
import test from "node:test";
import { addDays, ymdString } from "../lib/calendar/business.ts";
import { monthGridStart, shiftMonth } from "../lib/calendar/grid.ts";

test("a month grid starts on the Sunday on or before the 1st and covers six whole weeks", () => {
  // October 2026 starts on a Thursday, so the grid starts Sunday September 27.
  assert.equal(ymdString(monthGridStart({ y: 2026, m: 10, d: 24 })), "2026-09-27");
  // A month that starts on a Sunday starts the grid on that day.
  assert.equal(ymdString(monthGridStart({ y: 2026, m: 2, d: 14 })), "2026-02-01");
  assert.equal(ymdString(addDays(monthGridStart({ y: 2026, m: 2, d: 14 }), 41)), "2026-03-14");
  // A grid always reaches the last day of the month, even the longest month starting late in a week.
  assert.ok(ymdString(addDays(monthGridStart({ y: 2026, m: 8, d: 1 }), 41)) >= "2026-08-31");
});

test("moving by months crosses the year in both directions", () => {
  assert.equal(shiftMonth({ y: 2026, m: 12, d: 15 }, 1), "2027-01-01");
  assert.equal(shiftMonth({ y: 2026, m: 1, d: 31 }, -1), "2025-12-01");
  assert.equal(shiftMonth({ y: 2026, m: 10, d: 24 }, 0), "2026-10-01");
  assert.equal(shiftMonth({ y: 2026, m: 3, d: 31 }, -13), "2025-02-01");
});
