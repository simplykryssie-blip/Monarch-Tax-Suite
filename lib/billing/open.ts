import { captchaConfigured } from "./captcha.ts";
import { billingProblems } from "./plans.ts";
import { PLATFORM_LEGAL_APPROVED } from "../platform-legal.ts";

// Whether self-serve signup is open on this deployment. In production it needs billing configured, the owner's approval of
// the policies the signup agrees to, and the bot check. On a Preview or locally the approval and the bot check are not
// required, so the whole flow can be tested with Stripe's test cards.

export type SignupState = { open: true } | { open: false; reasons: string[] };

export function signupState(env: Record<string, string | undefined>, legalApproved: boolean = PLATFORM_LEGAL_APPROVED): SignupState {
  const reasons = billingProblems(env);
  if (env.VERCEL_ENV === "production") {
    if (!legalApproved) reasons.push("The Terms, Privacy and Refund policies haven't been approved yet.");
    if (!captchaConfigured(env)) reasons.push("The bot check (TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY) isn't set up.");
  }
  return reasons.length ? { open: false, reasons } : { open: true };
}
