// Password reset: the real reason a password could not be updated, and whether the reset page must ask for a code. Pure.

export const TWO_STEP_NEEDED = "Enter the 6-digit code from your authenticator app to confirm it is you.";
export const TWO_STEP_WRONG = "That code didn't match. Check the time on your phone and try the newest code.";

type UpdateError = { code?: string; message?: string; reasons?: string[] } | null | undefined;

/** What to tell the person when Supabase refuses a password change. Unknown errors keep the general advice. */
export function passwordUpdateMessage(error: NonNullable<UpdateError>): string {
  switch (error.code) {
    case "insufficient_aal": return TWO_STEP_NEEDED;
    case "same_password": return "Choose a password you have not used before.";
    case "weak_password": return "That password is too easy to guess. Use a longer password that is not a common word or one you use elsewhere.";
    case "reauthentication_needed":
    case "reauth_nonce_missing": return "For your security, request a new reset link and try again.";
    case "session_expired":
    case "session_not_found":
    case "refresh_token_not_found": return "Your reset link expired. Request a new one.";
    case "over_request_rate_limit": return "Too many attempts. Please wait a minute and try again.";
  }
  if (/same/i.test(error.message ?? "")) return "Choose a password you have not used before.";
  return "The password could not be updated. Please try again, or request a new reset link.";
}

/** The reset page asks for an authenticator code when the account has one verified and this session has not used it yet. */
export function needsTwoStepCode(input: { hasVerifiedFactor: boolean; level: string | null | undefined }): boolean {
  return input.hasVerifiedFactor && input.level !== "aal2";
}
