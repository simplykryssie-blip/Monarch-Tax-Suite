import { timingSafeEqual } from "node:crypto";

// How the HighLevel redirect to /api/integrations/crm/callback is handled.
//   denied    the user cancelled or HighLevel reported an error
//   verified  the install was started from our page: one-time state matches this browser's cookie
//   pending   an authorization code arrived without a matching state (for example an install started
//             inside HighLevel): finish by asking for the license key (see finishPendingInstall)
//   invalid   nothing usable
export type CallbackAction = "denied" | "verified" | "pending" | "invalid";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function classifyCallback(input: { error: string | null; code: string | null; state: string | null; cookieState: string | undefined | null }): CallbackAction {
  if (input.error) return "denied";
  if (!input.code) return "invalid";
  if (input.state && input.cookieState && same(input.state, input.cookieState)) return "verified";
  return "pending";
}
