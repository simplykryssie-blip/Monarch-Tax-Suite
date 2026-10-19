import { campaignDeps, recipientById, statusSignatureOk } from "@/lib/campaigns/server";
import { textReport } from "@/lib/campaigns/service.ts";

// Twilio's delivery report for a campaign text. The address carries a signature only this server can make, so a report
// for one text can't be forged for another.
export async function POST(request: Request, { params }: { params: Promise<{ id: string; sig: string }> }) {
  const { id, sig } = await params;
  if (!statusSignatureOk(id, sig)) return new Response("Unauthorized", { status: 401 });
  const form = new URLSearchParams(await request.text());
  const r = await recipientById(id);
  if (!r) return new Response("ok");
  try {
    await textReport(campaignDeps(r.tenant_id), r, (form.get("MessageStatus") ?? "").toLowerCase(), form.get("ErrorCode"));
  } catch (e) {
    console.error(`sms-status: failed: ${e instanceof Error ? e.message.slice(0, 160) : "unknown"}`);
    return new Response("Failed", { status: 500 });
  }
  return new Response("ok");
}
