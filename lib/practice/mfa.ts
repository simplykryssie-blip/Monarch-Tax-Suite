// Two-step sign-in for an independent PTIN holder's workspace is the holder's choice. The platform provides it and
// recommends it; it doesn't enforce it. Once a holder turns it on it is enforced at their every sign-in, until they
// turn it off. (The office area works the same way.)

export type MfaState = { level: string; hasFactor: boolean };

/**
 * What a signed-in holder must do before the workspace opens. "ok": open it. "verify": they have two-step sign-in
 * turned on and haven't entered a code in this session. A holder with none turned on is never sent to the setup page;
 * they are only offered it (the page has a Skip, and Security in the menu turns it on later).
 */
export function practiceMfaGate(state: MfaState): "ok" | "verify" {
  return state.hasFactor && state.level !== "aal2" ? "verify" : "ok";
}

/** Whether to remind a holder that two-step sign-in is available: only while they haven't turned it on. */
export const shouldRecommendMfa = (state: MfaState) => !state.hasFactor;
