import { blockEverywhere, campaignDeps, recipientByProviderId } from "@/lib/campaigns/server";
import { mailDelivered, mailProblem } from "@/lib/campaigns/service.ts";
import { interpretResendEvent, verifySvix } from "@/lib/campaigns/webhook.ts";

// Resend reports what happened to each campaign email. The signature is checked against the raw body first. A delivery
// is recorded; a permanent bounce or a spam complaint stops further campaign mail from that office and also goes on the
// platform-wide list (hashed). Soft bounces change nothing.
export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (!secret) return new Response("Webhook not configured", { status: 503 });
  const body = await request.text();
  const ok = verifySvix({ secret, id: request.headers.get("svix-id"), timestamp: request.headers.get("svix-timestamp"), signature: request.headers.get("svix-signature"), body });
  if (!ok) return new Response("Invalid signature", { status: 400 });
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return new Response("Bad request", { status: 400 }); }
  const event = interpretResendEvent(parsed);
  if (!event) return Response.json({ received: true, status: "ignored" });
  try {
    const r = await recipientByProviderId(event.emailId);
    if (!r) return Response.json({ received: true, status: "unknown" });
    const deps = campaignDeps(r.tenant_id);
    if (event.kind === "delivered") await mailDelivered(deps, r);
    else {
      await mailProblem(deps, r, event.kind === "complaint" ? "complained" : "bounced");
      await blockEverywhere("email", r.address, event.kind === "complaint" ? "complaint" : "hard_bounce");
    }
    return Response.json({ received: true, status: "processed" });
  } catch (e) {
    console.error(`resend-webhook: ${event.kind} failed: ${e instanceof Error ? e.message.slice(0, 160) : "unknown"}`);
    return new Response("Failed", { status: 500 });
  }
}
