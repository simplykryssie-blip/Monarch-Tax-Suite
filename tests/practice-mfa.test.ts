import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { practiceMfaGate, shouldRecommendMfa } from "../lib/practice/mfa.ts";

// Two-step sign-in is the PTIN holder's choice: skipped, the workspace opens with a password alone; turned on, it is
// enforced at every sign-in. The office area still requires it.

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("a holder who skips two-step sign-in", () => {
  test("opens the workspace with a password alone, and is only recommended it", () => {
    const state = { level: "aal1", hasFactor: false };
    assert.equal(practiceMfaGate(state), "ok");
    assert.equal(shouldRecommendMfa(state), true);
  });
  test("the setup page offers Skip only while it isn't on, and Skip goes into the workspace and is recorded", () => {
    const page = src("app/practice/mfa/page.tsx");
    assert.match(page, /\.\.\.\(hasFactor \? \{\} : \{ skip: skipPracticeMfaAction \}\)/);
    assert.doesNotMatch(page, /required|Safeguards Rule requires/i);
    assert.match(page, /strongly recommend/);
    const action = src("app/practice/actions.ts");
    assert.match(action, /skipPracticeMfaAction[\s\S]*mfa_skipped[\s\S]*redirect\("\/practice"\)/);
  });
  test("they can turn it on later from Security, and Home reminds them", () => {
    assert.match(src("app/practice/(area)/security/page.tsx"), /MfaSetup hasFactor=\{false\}/);
    assert.match(src("app/practice/(area)/layout.tsx"), /href="\/practice\/security"/);
    assert.match(src("app/practice/(area)/page.tsx"), /shouldRecommendMfa/);
  });
});

describe("a holder who turns it on", () => {
  test("is asked for a code at every sign-in until one is entered, and then opens the workspace", () => {
    assert.equal(practiceMfaGate({ level: "aal1", hasFactor: true }), "verify");
    assert.equal(practiceMfaGate({ level: "aal2", hasFactor: true }), "ok");
    assert.equal(shouldRecommendMfa({ level: "aal2", hasFactor: true }), false);
  });
  test("the workspace guard enforces that decision, and the code check still goes through the TOTP verify", () => {
    const guard = src("lib/practice/server.ts");
    assert.match(guard, /practiceMfaGate\(await mfaState\(\)\) === "verify"\) redirect\("\/practice\/mfa"\)/);
    assert.doesNotMatch(guard, /level !== "aal2"/);
    const actions = src("app/practice/actions.ts");
    assert.match(actions, /challengeAndVerify\(\{ factorId, code \}\)/);
    assert.match(src("app/practice/mfa/page.tsx"), /level === "aal2"\) redirect\("\/practice"\)/);
  });
  test("the setup page gives no way to skip a code that is already required", () => {
    const comp = src("components/office/mfa-setup.tsx");
    assert.match(comp, /act\.skip && !hasFactor/);
  });
});

describe("the office area is unchanged", () => {
  test("it still requires two-step sign-in", () => {
    assert.match(src("lib/office/server.ts"), /if \(mfa\.level !== "aal2"\) redirect\("\/office\/mfa"\)/);
  });
});
