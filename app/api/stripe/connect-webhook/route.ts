import { emitInvoicePaid } from "@/lib/automation/emit";
import { connectProblems } from "@/lib/connect/config.ts";
import { dispatchConnectEvent } from "@/lib/connect/dispatch.ts";
import { handleConnectEvent, type ConnectEvent } from "@/lib/connect/service.ts";
import { connectDeps, tenantForConnectedAccount } from "@/lib/connect/server";
import { connectStripe } from "@/lib/connect/stripe-port";
import { handleStripeEvent } from "@/lib/commerce/fulfillment.ts";
import { stripeFulfillmentDeps } from "@/lib/stripe-fulfillment";
import { loadStoreStripe } from "@/lib/store-stripe/server";
import { currentTenantId } from "@/lib/tenants.ts";

// Stripe Connect webhook: events from the workspaces' connected accounts. The signature is verified against the raw body
// first; the connected account on the event names the workspace. An invoice payment is applied to its invoice once; a sale in
// the store goes to the store's fulfilment (the same handler its own webhook uses, idempotent per event and payment).
// Events of accounts that are not connected to a workspace here are acknowledged and ignored.
export async function POST(request: Request) {
  const s = connectStripe();
  const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
  if (!s || !secret) {
    console.error(`stripe-connect-webhook: not configured: ${connectProblems(process.env).join(" ")}`);
    return new Response("Webhook not configured", { status: 503 });
  }
  const signature = request.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });
  const body = await request.text();
  let event;
  try {
    event = await s.stripe.webhooks.constructEventAsync(body, signature, secret);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }
  // A test event must never touch a live deployment's invoices (or the reverse).
  if (event.livemode !== s.port.livemode) {
    console.warn(`stripe-connect-webhook: ${event.id} ${event.type} rejected (mode mismatch)`);
    return new Response("Event mode does not match this deployment", { status: 400 });
  }
  try {
    const outcome = await dispatchConnectEvent(
      {
        tenantForAccount: tenantForConnectedAccount,
        async invoiceOrConnection(tenantId, e) {
          const deps = connectDeps(tenantId);
          if (!deps) return { status: "ignored" };
          const result = await handleConnectEvent(deps, e as unknown as ConnectEvent);
          if (result.status === "processed" && result.paid && result.invoiceId) await emitInvoicePaid(result.invoiceId, tenantId);
          return result;
        },
        async store(tenantId, e) {
          // Only the workspace that sells through the storefront (Monarch), and only while its store is running on this very account.
          if (tenantId !== currentTenantId()) return null;
          const st = await loadStoreStripe(tenantId);
          if (!st.stripe || st.connectedAccount !== (e as { account?: string }).account) return null;
          return handleStripeEvent(stripeFulfillmentDeps(st.stripe), e as unknown as Parameters<typeof handleStripeEvent>[1]);
        },
      },
      event as unknown as Parameters<typeof dispatchConnectEvent>[1],
    );
    console.info(`stripe-connect-webhook: ${event.id} ${event.type} -> ${outcome.route}:${outcome.status}`);
    return Response.json({ received: true, status: outcome.status });
  } catch (error) {
    console.error(`stripe-connect-webhook: ${event.id} ${event.type} failed: ${error instanceof Error ? error.message : "unknown"}`);
    return new Response("Processing failed", { status: 500 });
  }
}
