import { emitInvoicePaid } from "@/lib/automation/emit";
import { connectProblems } from "@/lib/connect/config.ts";
import { handleConnectEvent, type ConnectEvent } from "@/lib/connect/service.ts";
import { connectDeps, tenantForConnectedAccount } from "@/lib/connect/server";
import { connectStripe } from "@/lib/connect/stripe-port";

// Stripe Connect webhook: events from the offices' connected accounts. The signature is verified against the raw body
// first; the connected account on the event names the office; a paid session is applied to its invoice once.
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
    const account = (event as { account?: string }).account;
    const tenantId = account ? await tenantForConnectedAccount(account) : null;
    const deps = tenantId ? connectDeps(tenantId) : null;
    if (!tenantId || !deps) return Response.json({ received: true, status: "ignored" });
    const outcome = await handleConnectEvent(deps, event as unknown as ConnectEvent);
    if (outcome.status === "processed" && outcome.paid && outcome.invoiceId) await emitInvoicePaid(outcome.invoiceId, tenantId);
    console.info(`stripe-connect-webhook: ${event.id} ${event.type} -> ${outcome.status}`);
    return Response.json({ received: true, status: outcome.status });
  } catch (error) {
    console.error(`stripe-connect-webhook: ${event.id} ${event.type} failed: ${error instanceof Error ? error.message : "unknown"}`);
    return new Response("Processing failed", { status: 500 });
  }
}
