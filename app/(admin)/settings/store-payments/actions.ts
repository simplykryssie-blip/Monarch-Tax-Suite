"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { requireSection } from "@/lib/tier-server";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { disconnect, refreshConnection, signState } from "@/lib/connect/service.ts";
import { connectDeps, connectStateKey } from "@/lib/connect/server";
import { connectRedirectUri } from "@/lib/connect/redirect";
import { checkStoreStripe, removeStoreStripe, saveStoreStripe } from "@/lib/store-stripe/server";
import { currentTenantId } from "@/lib/tenants.ts";

// The workspace's own storefront Stripe keys. Every action re-checks access. Nothing here ever returns or logs a key.

const BASE = "/settings/store-payments";
const go = (key: "notice" | "error", message: string) => redirect(`${BASE}?${key}=${encodeURIComponent(message)}`);

export async function saveStoreKeysAction(form: FormData) {
  const admin = await requireSection("store");
  const secretKey = form.get("secret_key");
  const webhookSecret = form.get("webhook_secret");
  const result = await saveStoreStripe(currentTenantId(), admin.userId, { secretKey, webhookSecret });
  revalidatePath(BASE);
  if (!result.ok) return go("error", result.error);
  return go("notice", `Saved${result.mode ? ` (${result.mode} mode)` : ""}. Use "Check the connection" to confirm Stripe accepts it.`);
}

export async function checkStoreKeysAction() {
  await requireSection("store");
  const r = await checkStoreStripe(currentTenantId());
  return go(r.ok ? "notice" : "error", r.message);
}

export async function removeStoreKeysAction(form: FormData) {
  const admin = await requireSection("store");
  if (form.get("confirm") !== "on") return go("error", "Tick the box to confirm you want to remove the saved keys.");
  await removeStoreStripe(currentTenantId(), admin.userId);
  revalidatePath(BASE);
  return go("notice", "The saved keys were removed.");
}

// ------------------------------------------------------------- connecting a Stripe account (Stripe Connect)
// The same connection that serves client invoice payments (Settings → Payments), so one connect covers both.

const failure = (e: unknown) => {
  if (e instanceof ValidationError) return e.message;
  console.error(`store-payments connect action failed: ${sanitizeError(e, 200)}`);
  return "That did not work. Nothing was changed. Please try again.";
};

export async function connectStoreStripeAction() {
  const admin = await requireSection("store");
  let target: string;
  try {
    const deps = connectDeps(currentTenantId());
    const key = connectStateKey();
    if (!deps || !key) throw new ValidationError("Connecting Stripe isn't set up on this deployment yet. The platform administrator needs to add the Stripe Connect settings.");
    target = deps.stripe.authorizeUrl(signState(key, { tenantId: deps.tenantId, userId: admin.userId, back: "store-payments" }), await connectRedirectUri());
  } catch (e) {
    unstable_rethrow(e);
    target = `${BASE}?error=${encodeURIComponent(failure(e))}`;
  }
  redirect(target);
}

export async function refreshStoreConnectionAction() {
  await requireSection("store");
  let target: string;
  try {
    const deps = connectDeps(currentTenantId());
    if (!deps) throw new ValidationError("Connecting Stripe isn't set up on this deployment yet.");
    await refreshConnection(deps);
    target = `${BASE}?notice=${encodeURIComponent("Updated from Stripe.")}`;
  } catch (e) {
    unstable_rethrow(e);
    target = `${BASE}?error=${encodeURIComponent(failure(e))}`;
  }
  revalidatePath(BASE);
  redirect(target);
}

export async function disconnectStoreStripeAction(form: FormData) {
  const admin = await requireSection("store");
  if (form.get("confirm") !== "on") return go("error", "Tick the box to confirm you want to disconnect your Stripe account.");
  let target: string;
  try {
    const deps = connectDeps(currentTenantId());
    if (!deps) throw new ValidationError("Connecting Stripe isn't set up on this deployment yet.");
    await disconnect(deps, admin.userId);
    target = `${BASE}?notice=${encodeURIComponent("Stripe disconnected. The store uses your saved keys, if you have any.")}`;
  } catch (e) {
    unstable_rethrow(e);
    target = `${BASE}?error=${encodeURIComponent(failure(e))}`;
  }
  revalidatePath(BASE);
  revalidatePath("/settings/payments");
  redirect(target);
}
