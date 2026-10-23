"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSection } from "@/lib/tier-server";
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
