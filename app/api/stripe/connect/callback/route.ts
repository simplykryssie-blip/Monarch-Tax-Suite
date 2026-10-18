import { requireAdmin } from "@/lib/admin";
import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { finishConnect, readState } from "@/lib/connect/service.ts";
import { connectDeps, connectStateKey } from "@/lib/connect/server";
import { appOrigin } from "@/lib/admin";
import { currentTenantId } from "@/lib/tenants.ts";

// Stripe sends the person back here after they authorize (or refuse) the connection. The signed state must name this
// office and this signed-in person, so a link someone else started can't connect an account here.

export async function GET(request: Request) {
  const admin = await requireAdmin();
  const url = new URL(request.url);
  const origin = (await appOrigin()).replace(/\/$/, "");
  const to = (key: "notice" | "error", message: string) => Response.redirect(`${origin}/settings/payments?${key}=${encodeURIComponent(message)}`, 303);
  if (url.searchParams.get("error")) return to("error", url.searchParams.get("error") === "access_denied" ? "The connection was cancelled in Stripe. Nothing was changed." : "Stripe could not connect that account. Try again.");
  const key = connectStateKey();
  const deps = connectDeps(currentTenantId());
  if (!key || !deps) return to("error", "Online payments aren't configured on this deployment yet.");
  const state = readState(key, url.searchParams.get("state"));
  if (!state || state.tenantId !== deps.tenantId || state.userId !== admin.userId) return to("error", "That connection link expired or wasn't started by you. Start again from Settings → Payments.");
  try {
    const conn = await finishConnect(deps, admin.userId, url.searchParams.get("code") ?? "");
    return to("notice", conn.charges_enabled ? "Stripe connected. Clients can pay invoices online." : "Stripe connected, but Stripe says the account can't take payments yet. Finish setting it up in Stripe, then refresh here.");
  } catch (e) {
    if (!(e instanceof ValidationError)) console.error(`stripe-connect: callback failed: ${sanitizeError(e, 200)}`);
    return to("error", e instanceof ValidationError ? e.message : "Stripe couldn't connect that account. Nothing was changed. Try again.");
  }
}
