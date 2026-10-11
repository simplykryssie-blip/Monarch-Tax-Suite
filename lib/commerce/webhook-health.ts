// Webhook health: does Stripe send payment events to this app's webhook, at the right address, for every event the
// webhook handles? Pure, so the admin view and the one-click fix decide the same way.
//
// The fix only ever changes an existing endpoint's URL (and adds missing events). Updating an endpoint keeps its
// signing secret, so STRIPE_WEBHOOK_SECRET stays valid and no environment change is needed. It never creates or
// deletes endpoints, and refuses when it cannot tell which endpoint is this app's.

export const WEBHOOK_PATH = "/api/stripe/webhook";

/** Every event type the webhook handles (lib/commerce/fulfillment.ts applyEvent). */
export const HANDLED_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_intent.canceled",
  "charge.refunded",
  "charge.dispute.created",
] as const;

export type WebhookEndpointFacts = { id: string; url: string; status: string; enabled_events: string[]; livemode: boolean };

export type WebhookHealth =
  | { state: "ok"; endpoint: WebhookEndpointFacts; expectedUrl: string }
  | { state: "fixable"; endpoint: WebhookEndpointFacts; expectedUrl: string; problems: string[]; missingEvents: string[] }
  | { state: "manual"; expectedUrl: string; problems: string[] };

const samePath = (url: string) => {
  try {
    return new URL(url).pathname.replace(/\/$/, "") === WEBHOOK_PATH;
  } catch {
    return false;
  }
};

/** The webhook address for this app's public origin (NEXT_PUBLIC_APP_URL in production). */
export const expectedWebhookUrl = (origin: string) => `${origin.replace(/\/$/, "")}${WEBHOOK_PATH}`;

export function assessWebhooks(endpoints: WebhookEndpointFacts[], expectedUrl: string): WebhookHealth {
  const exact = endpoints.filter((e) => e.url === expectedUrl);
  const ours = exact.length ? exact : endpoints.filter((e) => samePath(e.url));
  if (ours.length === 0) {
    return { state: "manual", expectedUrl, problems: [endpoints.length ? "No Stripe webhook endpoint sends events to this app's webhook path." : "There is no Stripe webhook endpoint, so payments are never recorded."] };
  }
  if (ours.length > 1) {
    return { state: "manual", expectedUrl, problems: [`${ours.length} Stripe webhook endpoints point at this app's webhook path (${ours.map((e) => e.url).join(", ")}). Each has its own signing secret and only one matches STRIPE_WEBHOOK_SECRET; remove the extra one in Stripe.`] };
  }
  const endpoint = ours[0];
  const all = endpoint.enabled_events.includes("*");
  const missingEvents = all ? [] : HANDLED_EVENTS.filter((e) => !endpoint.enabled_events.includes(e));
  const problems: string[] = [];
  if (endpoint.url !== expectedUrl) problems.push(`It sends events to ${endpoint.url}, not ${expectedUrl}.`);
  if (endpoint.status !== "enabled") problems.push("It is disabled in Stripe, so no events are sent. Enable it in Stripe → Developers → Webhooks.");
  if (missingEvents.length) problems.push(`It does not send ${missingEvents.join(", ")}.`);
  if (problems.length === 0) return { state: "ok", endpoint, expectedUrl };
  // A disabled endpoint is the owner's call in Stripe; the fix only changes the address and the event list.
  if (endpoint.status !== "enabled") return { state: "manual", expectedUrl, problems };
  return { state: "fixable", endpoint, expectedUrl, problems, missingEvents };
}

/** What the fix sends to Stripe: the expected URL, and the handled events added to the ones already enabled. */
export function webhookFix(health: Extract<WebhookHealth, { state: "fixable" }>): { url: string; enabled_events: string[] | undefined } {
  return {
    url: health.expectedUrl,
    enabled_events: health.missingEvents.length ? [...new Set([...health.endpoint.enabled_events, ...health.missingEvents])] : undefined,
  };
}
