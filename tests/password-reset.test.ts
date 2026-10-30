import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { needsTwoStepCode, passwordUpdateMessage, TWO_STEP_NEEDED } from "../lib/password-reset.ts";

describe("password reset", () => {
  test("asks for the authenticator code only when the account has one and this session has not used it", () => {
    assert.equal(needsTwoStepCode({ hasVerifiedFactor: true, level: "aal1" }), true);
    assert.equal(needsTwoStepCode({ hasVerifiedFactor: true, level: undefined }), true);
    assert.equal(needsTwoStepCode({ hasVerifiedFactor: true, level: "aal2" }), false);
    assert.equal(needsTwoStepCode({ hasVerifiedFactor: false, level: "aal1" }), false, "no factor: the reset is unchanged");
  });

  test("shows the real reason instead of one generic string", () => {
    assert.equal(passwordUpdateMessage({ code: "insufficient_aal" }), TWO_STEP_NEEDED);
    assert.match(passwordUpdateMessage({ code: "same_password" }), /not used before/);
    assert.match(passwordUpdateMessage({ code: "weak_password" }), /too easy to guess/);
    assert.match(passwordUpdateMessage({ message: "New password should be different from the old password." }), /not used before|try again/);
    assert.match(passwordUpdateMessage({ code: "session_expired" }), /expired/);
    assert.doesNotMatch(passwordUpdateMessage({ code: "unexpected" }), /longer or less common/);
  });
});
