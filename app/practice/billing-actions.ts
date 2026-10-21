"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { appOrigin } from "@/lib/admin";
import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { billingDeps } from "@/lib/billing/server";
import { changePlan, pauseWorkspace, resumeWorkspace, startReactivation } from "@/lib/billing/service.ts";
import { PLANS } from "@/lib/billing/plans.ts";
import { requirePractice } from "@/lib/practice/server";

// Billing actions for a workspace's owner. Each one acts only on the signed-in owner's own workspace.

const BASE = "/practice/billing";
const go = (key: "notice" | "error", message: string) => `${BASE}?${key}=${encodeURIComponent(message)}`;
const failure = (e: unknown) => {
  if (e instanceof ValidationError) return e.message;
  console.error(`billing action failed: ${sanitizeError(e, 200)}`);
  return "That did not work. Nothing was changed. Please try again.";
};

async function run(fn: (ctx: Awaited<ReturnType<typeof requirePractice>>, deps: NonNullable<ReturnType<typeof billingDeps>>) => Promise<string>) {
  const ctx = await requirePractice();
  let target: string;
  try {
    const deps = billingDeps();
    if (!deps) throw new ValidationError("Billing isn't available right now.");
    target = await fn(ctx, deps);
  } catch (e) {
    unstable_rethrow(e);
    target = go("error", failure(e));
  }
  revalidatePath(BASE);
  redirect(target);
}

/** Stripe's page for the card, invoices, receipts and cancelling. */
export async function openBillingPortalAction() {
  await run(async (ctx, deps) => {
    const sub = await deps.repo.byTenant(ctx.tenantId);
    if (!sub?.stripe_customer_id) throw new ValidationError("There's nothing to manage yet.");
    return deps.stripe.portalUrl(sub.stripe_customer_id, `${(await appOrigin()).replace(/\/$/, "")}${BASE}`);
  });
}
export async function pauseAction() {
  await run(async (ctx, deps) => { await pauseWorkspace(deps, ctx.tenantId); return go("notice", "Your plan is paused. Your data is safe."); });
}
export async function resumeAction() {
  await run(async (ctx, deps) => { await resumeWorkspace(deps, ctx.tenantId); return go("notice", "Your plan is active again."); });
}
export async function reactivateAction() {
  await run(async (ctx, deps) => (await startReactivation(deps, ctx.tenantId, ctx.email)).url);
}

/** Looks at the cost first: sends the owner back to the Billing page showing what they would pay. */
export async function previewPlanChangeAction(form: FormData) {
  await requirePractice();
  const to = typeof form.get("plan") === "string" ? (form.get("plan") as string) : "";
  redirect(`${BASE}?change=${encodeURIComponent(to)}`);
}
export async function changePlanAction(form: FormData) {
  await run(async (ctx, deps) => {
    const plan = await changePlan(deps, ctx.tenantId, form.get("plan"), form.get("proration_date"));
    return go("notice", `Your plan is now ${PLANS[plan].label}.`);
  });
}
