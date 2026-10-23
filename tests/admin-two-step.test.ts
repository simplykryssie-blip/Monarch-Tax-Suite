import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { adminRouteVerdict } from "../lib/admin-host.ts";
import { ADMIN_TWO_STEP_PATH, adminTwoStepGate, factorToCheck, twoStepScreen } from "../lib/admin-two-step.ts";
import { callbackFailureMessage, isTokenHash, RESET_LINK_EXPIRED, RESET_LINK_INVALID, RESET_LINK_OTHER_BROWSER } from "../lib/auth-links.ts";
import { isPlatformAction, PLATFORM_ACTION_LABEL } from "../lib/platform-audit.ts";

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
/** The text of one top-level `export const name = cache(async ...` / function block, up to the next top-level export. */
const block = (file: string, start: string) => {
  const text = src(file);
  const i = text.indexOf(start);
  assert.ok(i >= 0, `${start} not found`);
  const rest = text.slice(i + start.length);
  const j = rest.search(/\n(?:export |\/\*\*)/);
  return rest.slice(0, j < 0 ? undefined : j);
};

describe("the platform administrator must use two-step sign-in", () => {
  test("no authenticator: set one up, with no way to skip; authenticator but no code this session: enter a code", () => {
    assert.equal(adminTwoStepGate({ level: "aal1", hasFactor: false }), "enroll");
    assert.equal(adminTwoStepGate({ level: "aal2", hasFactor: false }), "enroll");
    assert.equal(adminTwoStepGate({ level: "aal1", hasFactor: true }), "verify");
    assert.equal(adminTwoStepGate({ level: "aal2", hasFactor: true }), "ok");
  });
  test("the existing administrator, who already has an authenticator, is asked for a code (never to set one up again)", () => {
    assert.equal(adminTwoStepGate({ level: "aal1", hasFactor: true }), "verify");
    assert.equal(twoStepScreen({ level: "aal1", hasFactor: true }, true), "verify");
  });
  test("an account that is not an administrator yet can set up its authenticator and then sees a confirmation", () => {
    assert.equal(twoStepScreen({ level: "aal1", hasFactor: false }, false), "enroll");
    assert.equal(twoStepScreen({ level: "aal2", hasFactor: true }, false), "done");
    assert.equal(twoStepScreen({ level: "aal2", hasFactor: true }, true), "open");
  });
  test("the platform-admin guard enforces it after the administrator check, and the Monarch workspace guard does not", () => {
    const guard = block("lib/admin.ts", "export const requirePlatformAdmin");
    const admin = guard.indexOf("isAdminUser(session.userId)");
    const gate = guard.indexOf("adminTwoStepGate(");
    assert.ok(admin >= 0 && gate > admin, "the two-step check follows the administrator check");
    assert.match(guard, /!== "ok"\) redirect\(ADMIN_TWO_STEP_PATH\)/);
    assert.match(guard, /status === "verified"/);
    assert.doesNotMatch(block("lib/admin.ts", "export const requireAdmin"), /adminTwoStepGate|mfa/);
  });
});

describe("the two-step screen", () => {
  const page = src("app/(platform-access)/admin/two-step/page.tsx");
  const actions = src("app/(platform-access)/admin/two-step/actions.ts");
  test("is served on the admin address and sits outside the guarded /admin frame, so the guard cannot loop on it", () => {
    assert.equal(ADMIN_TWO_STEP_PATH, "/admin/two-step");
    const env = { ADMIN_HOSTS: "admin.example.com" };
    assert.equal(adminRouteVerdict("admin.example.com", ADMIN_TWO_STEP_PATH, env).action, "allow");
    assert.equal(adminRouteVerdict("app.example.com", ADMIN_TWO_STEP_PATH, env).action, "deny");
    assert.ok(!page.includes("requirePlatformAdmin"));
  });
  test("offers no skip, and signs a visitor in first", () => {
    assert.doesNotMatch(page, /skip\s*:|skip\w*Action/i);
    assert.doesNotMatch(actions, /skip\s*:|skip\w*Action|export async function skip/i);
    assert.match(page, /cannot be skipped/);
    assert.match(page, /redirect\("\/login\?next=\/admin\/two-step"\)/);
  });
  test("checks a code against the authenticator already set up, never a newly added one, then records first-time setup", () => {
    assert.match(actions, /const factorId = factorToCheck\(factors, input\.factorId\)/);
    assert.match(actions, /challengeAndVerify\(\{ factorId, code \}\)/);
    assert.match(actions, /if \(!verified\) await recordPlatformAction\(user\.id, "platform_two_step_enrolled"/);
    assert.match(actions, /isAdminUser\(user\.id\)\) \? "\/admin\/workspaces" : "\/admin\/two-step"/);
  });
  test("a person on the screen can always sign out, so a setup that cannot be finished never traps the session", () => {
    assert.equal((page.match(/<form action=\{signOut\}>/g) ?? []).length, 2, "setup/verify and the confirmation both have it");
    assert.match(page, /import \{ signOut \} from "@\/lib\/auth-actions"/);
  });
  test("setup is recorded in the platform activity log", () => {
    assert.ok(isPlatformAction("platform_two_step_enrolled"));
    assert.ok(PLATFORM_ACTION_LABEL.platform_two_step_enrolled);
  });
});

describe("password-reset links", () => {
  test("a link opened in a different browser says so instead of claiming it expired", () => {
    assert.equal(callbackFailureMessage({ name: "AuthPKCECodeVerifierMissingError" }), RESET_LINK_OTHER_BROWSER);
    assert.equal(callbackFailureMessage({ code: "pkce_code_verifier_not_found" }), RESET_LINK_OTHER_BROWSER);
    assert.equal(callbackFailureMessage({ name: "AuthApiError", code: "flow_state_not_found" }), RESET_LINK_EXPIRED);
    assert.equal(callbackFailureMessage(null), RESET_LINK_EXPIRED);
    assert.doesNotMatch(RESET_LINK_OTHER_BROWSER, /expired|already used/);
    const route = src("app/auth/callback/route.ts");
    assert.match(route, /fail\(callbackFailureMessage\(error\)\)/);
    assert.match(route, /fail\(RESET_LINK_INVALID\)/);
  });
  test("the emailed token is accepted only in its expected shape", () => {
    assert.equal(isTokenHash("a1b2c3d4e5f6a7b8c9d0e1f2"), true);
    for (const bad of [undefined, null, "", "short", "has space in it 1234567890", "x".repeat(200), "<script>alert(1)</script>"]) assert.equal(isTokenHash(bad), false, String(bad));
    assert.notEqual(RESET_LINK_INVALID, RESET_LINK_EXPIRED);
  });
  test("the confirm page only shows a button; the token is used by the action, for a recovery token only", () => {
    const page = src("app/auth/confirm/page.tsx");
    assert.doesNotMatch(page, /verifyOtp/);
    assert.match(page, /<form action=\{confirmRecoveryLink\}>/);
    assert.match(page, /type !== "recovery" \|\| !isTokenHash\(tokenHash\)/);
    assert.match(page, /referrer: "no-referrer"/);
    const action = block("lib/auth-actions.ts", "export async function confirmRecoveryLink");
    assert.match(action, /verifyOtp\(\{ type: "recovery", token_hash: tokenHash \}\)/);
    assert.match(action, /redirect\("\/reset-password"\)/);
  });
  test("/auth/confirm is reachable without a session, like the callback", () => {
    assert.match(src("lib/supabase/proxy.ts"), /"\/forgot-password", "\/reset-password", "\/auth\/"/);
  });
});

describe("which authenticator a code is checked against", () => {
  // The shape Supabase returns: `totp` holds VERIFIED factors only; a setup in progress is only in `all`.
  const pending = { id: "11111111-1111-4111-8111-111111111111", factor_type: "totp", status: "unverified" };
  const verified = { id: "22222222-2222-4222-8222-222222222222", factor_type: "totp", status: "verified" };

  test("first-time setup checks the factor just created, which is only in the full list", () => {
    assert.equal(factorToCheck({ all: [pending], totp: [] }, pending.id), pending.id);
  });
  test("a code with no setup in progress and nothing verified has nothing to check", () => {
    assert.equal(factorToCheck({ all: [], totp: [] }, undefined), null);
    assert.equal(factorToCheck({ all: [pending], totp: [] }, undefined), null);
    assert.equal(factorToCheck(null, pending.id), null);
  });
  test("a submitted id that is not the person's own pending authenticator is ignored", () => {
    assert.equal(factorToCheck({ all: [pending], totp: [] }, "99999999-9999-4999-8999-999999999999"), null);
    assert.equal(factorToCheck({ all: [{ ...pending, factor_type: "phone" }], totp: [] }, pending.id), null);
  });
  test("with a verified authenticator its code is always required, even if another factor id is submitted", () => {
    assert.equal(factorToCheck({ all: [verified, pending], totp: [verified] }, undefined), verified.id);
    assert.equal(factorToCheck({ all: [verified, pending], totp: [verified] }, pending.id), verified.id);
  });
});
