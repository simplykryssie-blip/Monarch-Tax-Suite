import { billingDeps } from "@/lib/billing/server";
import { billingStripe } from "@/lib/billing/stripe-port";
import { handleBillingEvent, type BillingEvent } from "@/lib/billing/service.ts";

// Verexa HQ's subscription webhook (the platform's Stripe account, not Connect and not the storefront). The signature is
// checked against the raw body first; a paid signup makes the workspace; renewals, failures and cancellations move the
// account along. A repeated delivery changes nothing.
export async function POST(request: Request) {
  const s = billingStripe();
  const secret = process.env.STRIPE_BILLING_WEBHOOK_SECRET;
  const deps = billingDeps();
  if (!s || !secret || !deps) return new Response("Webhook not configured", { status: 503 });
  const signature = request.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });
  const body = await request.text();
  let event;
  try {
    event = await s.stripe.webhooks.constructEventAsync(body, signature, secret);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }
  if (event.livemode !== s.livemode) {
    console.warn(`billing-webhook: ${event.id} ${event.type} rejected (mode mismatch)`);
    return new Response("Event mode does not match this deployment", { status: 400 });
  }
  try {
    const outcome = await handleBillingEvent(deps, event as unknown as BillingEvent);
    console.info(`billing-webhook: ${event.id} ${event.type} -> ${outcome.status}`);
    return Response.json({ received: true, status: outcome.status });
  } catch (e) {
    console.error(`billing-webhook: ${event.id} ${event.type} failed: ${e instanceof Error ? e.message.slice(0, 160) : "unknown"}`);
    return new Response("Failed", { status: 500 });
  }
}
