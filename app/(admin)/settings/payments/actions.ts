"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { disconnect, refreshConnection, signState } from "@/lib/connect/service.ts";
import { connectDeps, connectStateKey } from "@/lib/connect/server";
import { connectRedirectUri } from "@/lib/connect/redirect";
import { currentTenantId } from "@/lib/tenants.ts";

// Settings → Payments: connect the office's own Stripe account, refresh what it can do, disconnect.

const back = (key: "notice" | "error", message: string) => `/settings/payments?${key}=${encodeURIComponent(message)}`;
const failure = (e: unknown) => {
  if (e instanceof ValidationError) return e.message;
  console.error(`payments action failed: ${sanitizeError(e, 200)}`);
  if (/relation|schema cache|does not exist/i.test(e instanceof Error ? e.message : "")) return "Online payments aren't installed yet. Apply the Stripe Connect migration first.";
  return "That did not work. Nothing was changed. Please try again.";
};

export async function connectStripeAction() {
  const admin = await requireAdmin();
  let target: string;
  try {
    const deps = connectDeps(currentTenantId());
    const key = connectStateKey();
    if (!deps || !key) throw new ValidationError("Online payments aren't configured on this deployment yet. The platform administrator needs to add the Stripe Connect settings.");
    target = deps.stripe.authorizeUrl(signState(key, { tenantId: deps.tenantId, userId: admin.userId }), await connectRedirectUri());
  } catch (e) {
    unstable_rethrow(e);
    target = back("error", failure(e));
  }
  redirect(target);
}

export async function refreshStripeAction() {
  await requireAdmin();
  let target: string;
  try {
    const deps = connectDeps(currentTenantId());
    if (!deps) throw new ValidationError("Online payments aren't configured on this deployment yet.");
    await refreshConnection(deps);
    target = back("notice", "Updated from Stripe.");
  } catch (e) {
    unstable_rethrow(e);
    target = back("error", failure(e));
  }
  revalidatePath("/settings/payments");
  redirect(target);
}

export async function disconnectStripeAction() {
  const admin = await requireAdmin();
  let target: string;
  try {
    const deps = connectDeps(currentTenantId());
    if (!deps) throw new ValidationError("Online payments aren't configured on this deployment yet.");
    await disconnect(deps, admin.userId);
    target = back("notice", "Stripe disconnected. Clients can no longer pay invoices online.");
  } catch (e) {
    unstable_rethrow(e);
    target = back("error", failure(e));
  }
  revalidatePath("/settings/payments");
  redirect(target);
}
