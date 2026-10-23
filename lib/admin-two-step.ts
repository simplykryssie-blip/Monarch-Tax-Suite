// Two-step sign-in for the platform administrator. Unlike the PTIN holder's workspace (their choice) and like the office
// area, it is required: the /admin area can create workspaces, change access and run billing. Pure, so it can be tested;
// the wiring is in lib/admin.ts (the guard) and app/(platform-access)/admin/two-step (the screen).
//
// Only the platform's own area (/admin) is gated. The Monarch workspace's guard (requireAdmin) is unchanged, so a Monarch
// member without an authenticator is never locked out of the workspace by this.

export type TwoStepState = { level: string; hasFactor: boolean };

/** Where the platform administrator is sent to set up or enter a code. Under /admin so it is served on the admin address. */
export const ADMIN_TWO_STEP_PATH = "/admin/two-step";

/**
 * What a platform administrator must do before /admin opens.
 *   "ok":     a code was entered in this session.
 *   "verify": an authenticator is set up but no code was entered in this session (every sign-in).
 *   "enroll": no authenticator yet. Set one up now; there is no skip.
 */
export function adminTwoStepGate(state: TwoStepState): "ok" | "enroll" | "verify" {
  if (!state.hasFactor) return "enroll";
  return state.level === "aal2" ? "ok" : "verify";
}

/** What the screen shows: the gate's step, or a finished state when the signed-in account is done (or is not an administrator yet). */
export function twoStepScreen(state: TwoStepState, isPlatformAdmin: boolean): "enroll" | "verify" | "open" | "done" {
  const gate = adminTwoStepGate(state);
  if (gate !== "ok") return gate;
  return isPlatformAdmin ? "open" : "done";
}
