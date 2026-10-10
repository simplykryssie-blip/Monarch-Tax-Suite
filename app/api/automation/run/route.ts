import { timingSafeEqual } from "node:crypto";
import { automationDeps } from "@/lib/automation/server";
import { runDue } from "@/lib/automation/engine.ts";
import { sanitizeError } from "@/lib/automation/sanitize.ts";

// Scheduler endpoint: processes due retries. Protected by CRON_SECRET (Vercel Cron sends it as
// "Authorization: Bearer <CRON_SECRET>"; any other scheduler can do the same). It sends no email by itself:
// it only continues executions that already exist.
export const maxDuration = 60;

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

async function handle(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return new Response("Scheduler is not configured", { status: 503 });
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!given || !same(given, secret)) return new Response("Unauthorized", { status: 401 });
  try {
    const { processed } = await runDue(automationDeps(), 25);
    return Response.json({ processed });
  } catch (e) {
    console.error(`automation-run: ${sanitizeError(e, 160)}`);
    return new Response("Run failed", { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
