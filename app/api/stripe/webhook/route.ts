import { handleStripeEvent } from "@/lib/commerce/fulfillment.ts";
import { checkEventMode } from "@/lib/commerce/stripe-verify.ts";
import { stripeFulfillmentDeps } from "@/lib/stripe-fulfillment";
import { loadStoreStripe } from "@/lib/store-stripe/server";

// Stripe webhook: the only path that grants paid access automatically. The
// signature is verified against the raw body before anything is read, and
// processing is idempotent per event id and per payment intent.
export async function POST(request: Request) {
  // The storefront's keys are the workspace's own (saved in its settings; Monarch's still fall back to the server's
  // environment until they are moved). This endpoint serves the Monarch storefront.
  const { stripe, webhookSecret: secret, secretKey } = await loadStoreStripe();
  if (!stripe || !secret) {
    console.error("stripe-webhook: the Stripe secret key or the webhook signing secret is not set");
    return new Response("Webhook not configured", { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });

  const body = await request.text();
  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, secret);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  // Test-mode events must never fulfil orders on a live deployment (or the
  // reverse), even when correctly signed. Ids and the reason code only are logged.
  const modeCheck = checkEventMode(event.livemode, secretKey ?? undefined);
  if (!modeCheck.ok) {
    console.warn(`stripe-webhook: ${event.id} ${event.type} rejected (${modeCheck.reason})`);
    return new Response("Event mode does not match this deployment", { status: 400 });
  }

  try {
    const outcome = await handleStripeEvent(
      stripeFulfillmentDeps(stripe),
      event,
    );
    // Log ids and outcomes only — never customer or payment details.
    console.info(`stripe-webhook: ${event.id} ${event.type} -> ${outcome.status}`);
    return Response.json({ received: true, status: outcome.status });
  } catch (error) {
    console.error(`stripe-webhook: ${event.id} ${event.type} failed: ${error instanceof Error ? error.message : "unknown"}`);
    // Non-2xx so Stripe retries; the event is recorded as failed and will be reprocessed.
    return new Response("Processing failed", { status: 500 });
  }
}
