import { toE164 } from "@/lib/automation/twilio.ts";
import { campaignDeps, inboundSignatureOk, tenantForNumber } from "@/lib/campaigns/server";
import { keywordOf, textKeyword } from "@/lib/campaigns/service.ts";

// Text replies to an office's number. STOP (and its synonyms) stops campaign texts from that office to the sender, START
// brings them back, HELP answers with how to reach the office. Anything else is ignored here.
const reply = (message: string) => new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${message ? `<Message>${message.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</Message>` : ""}</Response>`, { headers: { "Content-Type": "text/xml" } });

export async function POST(request: Request, { params }: { params: Promise<{ sig: string }> }) {
  const { sig } = await params;
  if (!inboundSignatureOk(sig)) return new Response("Unauthorized", { status: 401 });
  const form = new URLSearchParams(await request.text());
  const from = toE164(form.get("From") ?? "");
  const to = toE164(form.get("To") ?? "");
  const word = keywordOf(form.get("Body") ?? "");
  if (!from || !to || !word) return reply("");
  const tenantId = await tenantForNumber(to);
  if (!tenantId) return reply("");
  const deps = campaignDeps(tenantId);
  if (word === "help") {
    const office = await deps.office();
    return reply(`${office.name}: for help call ${office.phone ?? "the office"}${office.email ? ` or email ${office.email}` : ""}. Reply STOP to opt out.`);
  }
  await textKeyword(deps, from, word);
  return reply(word === "stop" ? "You're unsubscribed and won't get more texts from this number. Reply START to rejoin." : "You're subscribed again.");
}
