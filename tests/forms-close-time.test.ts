import test from "node:test";
import assert from "node:assert/strict";
import { closeAtFromOfficeClock, closeAtToOfficeClock } from "../lib/forms/close-time.ts";

test("a close time typed on the office clock is stored as the real instant and shown back unchanged", () => {
  const iso = closeAtFromOfficeClock("2026-11-05T17:00", "America/Chicago");
  assert.equal(iso, "2026-11-05T23:00:00.000Z");
  assert.equal(closeAtToOfficeClock(iso, "America/Chicago"), "2026-11-05T17:00");
  assert.equal(closeAtToOfficeClock(null, "America/Chicago"), "");
});

test("summer time is respected", () => {
  assert.equal(closeAtFromOfficeClock("2026-07-01T09:30", "America/Chicago"), "2026-07-01T14:30:00.000Z");
});
