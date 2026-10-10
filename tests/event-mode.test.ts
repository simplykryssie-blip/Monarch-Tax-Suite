import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { checkEventMode } from "../lib/commerce/stripe-verify.ts";

// Fake keys with the real prefixes only; none of these are real credentials.
const LIVE_KEY = "sk_live_" + "x".repeat(24);
const TEST_KEY = "sk_test_" + "x".repeat(24);
const RESTRICTED_LIVE = "rk_live_" + "x".repeat(24);

describe("webhook event mode guard", () => {
  test("a live event is accepted only by a live deployment", () => {
    assert.deepEqual(checkEventMode(true, LIVE_KEY), { ok: true, mode: "live" });
    assert.deepEqual(checkEventMode(true, RESTRICTED_LIVE), { ok: true, mode: "live" });
    assert.deepEqual(checkEventMode(true, TEST_KEY), { ok: false, reason: "mode_mismatch" });
  });

  test("a test-mode event can never fulfil an order on a live deployment", () => {
    assert.deepEqual(checkEventMode(false, LIVE_KEY), { ok: false, reason: "mode_mismatch" });
    assert.deepEqual(checkEventMode(false, RESTRICTED_LIVE), { ok: false, reason: "mode_mismatch" });
  });

  test("a test deployment accepts test events and refuses live events", () => {
    assert.deepEqual(checkEventMode(false, TEST_KEY), { ok: true, mode: "test" });
    assert.deepEqual(checkEventMode(true, TEST_KEY), { ok: false, reason: "mode_mismatch" });
  });

  test("fails closed when the key mode or event mode is unknown", () => {
    assert.deepEqual(checkEventMode(true, undefined), { ok: false, reason: "key_mode_unknown" });
    assert.deepEqual(checkEventMode(true, ""), { ok: false, reason: "key_mode_unknown" });
    assert.deepEqual(checkEventMode(true, "not-a-stripe-key"), { ok: false, reason: "key_mode_unknown" });
    assert.deepEqual(checkEventMode(undefined, LIVE_KEY), { ok: false, reason: "event_mode_missing" });
    assert.deepEqual(checkEventMode(null, TEST_KEY), { ok: false, reason: "event_mode_missing" });
  });
});
