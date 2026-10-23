import { ValidationError } from "../commerce/validation.ts";

/**
 * What the person is told when connecting fails. A message we wrote ourselves is shown as is. If Stripe rejects the platform's own
 * key (a stale, rolled or wrong-account key in this deployment's settings), that is the platform administrator's to fix, so it
 * says so instead of inviting a retry that cannot work. Anything else stays generic. Never includes Stripe's text or any key.
 */
export function connectFailureMessage(e: unknown): string {
  if (e instanceof ValidationError) return e.message;
  const type = (e as { type?: string } | null)?.type;
  if (type === "StripeAuthenticationError") {
    return "Stripe rejected this deployment's Connect platform key, so your account could not be connected. The platform administrator needs to update the Connect settings (the platform secret key). Nothing was changed.";
  }
  return "Stripe couldn't connect that account. Nothing was changed. Try again.";
}
