import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { processDueLeads, purgeLeads } from "@/lib/crm/leads.ts";
import { crmDeps } from "@/lib/crm/server";

// Scheduled lead delivery retries and data-retention purge. Vercel Cron sends
// "Authorization: Bearer <CRON_SECRET>"; without CRON_SECRET configured this
// endpoint refuses every call.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const deps = crmDeps();
  const delivered = await processDueLeads(deps, { limit: 100 });
  const purged = await purgeLeads(deps);
  return NextResponse.json({ ...delivered, ...purged });
}
