import { commerceRepo, stripeClient } from "@/lib/admin";
import { handleStripeEvent } from "@/lib/commerce/fulfillment.ts";

// Stripe webhook: the only path that grants paid access automatically. The
// signature is verified against the raw body before anything is read, and
// processing is idempotent per event id and per payment intent.
export async function POST(request: Request) {
  const stripe = stripeClient();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) {
    console.error("stripe-webhook: STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET is not configured");
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

  try {
    const outcome = await handleStripeEvent(
      {
        repo: commerceRepo(),
        async listCheckoutProductIds(sessionId) {
          const items = await stripe.checkout.sessions.listLineItems(sessionId, { limit: 100, expand: ["data.price.product"] });
          return items.data
            .map((item) => item.price?.product)
            .map((product) => (typeof product === "string" ? product : product?.id))
            .filter((id): id is string => Boolean(id));
        },
      },
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
