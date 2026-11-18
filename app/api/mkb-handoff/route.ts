import { createHash, timingSafeEqual } from "node:crypto";
import { crmDeps } from "@/lib/crm/server";
import { webhookTarget } from "@/lib/crm/connection.ts";

// TEMPORARY (removed right after use): hands one customer's saved lead webhook to the MKB CRM, server to server.
// Only someone holding the one-time password (its SHA-256 is below; the password itself is in neither app) can
// trigger it. The webhook address is sent only to MKB and never returned.
const PASSWORD_SHA256 = "750d485bc36c7b4981ce7ae3b221c77e211f766dac993550094ebc4a09981cb2";
const LICENSE_ID = "5671a62d-39bb-4b7e-b72c-1e47301db824";
const EMBED_ID = "emb_NlShYHDPnWP5Wa-GJU6IIw";
const MKB = "https://www.monarchtaxsuite.com/api/public/calculator/handoff";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { token?: unknown };
  const token = typeof body.token === "string" ? body.token : "";
  const got = createHash("sha256").update(token).digest();
  if (!token || !timingSafeEqual(got, Buffer.from(PASSWORD_SHA256, "hex"))) return Response.json({ ok: false }, { status: 404 });
  const deps = crmDeps();
  const connection = await deps.repo.getLiveConnection(LICENSE_ID);
  if (!connection || connection.provider !== "webhook") return Response.json({ ok: false, step: "no_connection" }, { status: 409 });
  const { url } = webhookTarget(deps, connection);
  const res = await fetch(MKB, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, embedId: EMBED_ID, url }) });
  return Response.json({ ok: res.ok, mkbStatus: res.status }, { status: res.ok ? 200 : 502, headers: { "cache-control": "no-store" } });
}
