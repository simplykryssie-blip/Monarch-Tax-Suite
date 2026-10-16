import "server-only";
import type Stripe from "stripe";
import { commerceRepo, serviceOrdersRepo } from "./admin";
import { safeEmit } from "./automation/server";
import { handleStripeEvent, type FulfillmentDeps } from "./commerce/fulfillment.ts";
import { MONARCH_TENANT_ID } from "./tenants.ts";
import { fulfilPaidPlan } from "./wisp/service.ts";
import { wispDeps } from "./wisp/server";
import { fulfilSmsSession } from "./sms/server";

// What a paid Stripe checkout does in this app, shared by the webhook and by pages that confirm a payment
// themselves. Everything it runs is idempotent per payment intent, so the two never record or deliver twice.

export function stripeFulfillmentDeps(stripe: Stripe): FulfillmentDeps {
  return {
    repo: commerceRepo(),
    emit: safeEmit,
    services: { repo: serviceOrdersRepo(), tenantId: MONARCH_TENANT_ID },
    wisp: (input) => fulfilPaidPlan(wispDeps(MONARCH_TENANT_ID), input),
    sms: (session) => fulfilSmsSession(session),
    async listCheckoutProductIds(sessionId) {
      const items = await stripe.checkout.sessions.listLineItems(sessionId, { limit: 100, expand: ["data.price.product"] });
      return items.data
        .map((item) => item.price?.product)
        .map((product) => (typeof product === "string" ? product : product?.id))
        .filter((id): id is string => Boolean(id));
    },
  };
}

/**
 * Asks Stripe directly whether a checkout is paid and, if it is, records it exactly as the webhook would. For when
 * the webhook is late or can't reach this deployment. The session is read with this deployment's own secret key,
 * so it is as trustworthy as a signed event. Returns whether Stripe says it is paid.
 */
export async function confirmCheckoutFromStripe(stripe: Stripe, sessionId: string): Promise<boolean> {
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.status !== "complete" || session.payment_status !== "paid") return false;
  const event = { id: `confirm:${session.id}`, type: "checkout.session.completed", livemode: session.livemode, data: { object: session } };
  const outcome = await handleStripeEvent(stripeFulfillmentDeps(stripe), event as unknown as Parameters<typeof handleStripeEvent>[1]);
  console.info(`stripe-confirm: ${session.id} -> ${outcome.status}`);
  return true;
}
