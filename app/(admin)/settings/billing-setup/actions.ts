"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { explainStripeFailure } from "@/lib/billing/checkout-params.ts";
import { runBillingSetup } from "@/lib/billing/setup.ts";
import { billingSetupPort, billingStripe } from "@/lib/billing/stripe-port";

const BASE = "/settings/billing-setup";
const go = (key: "notice" | "error", message: string) => `${BASE}?${key}=${encodeURIComponent(message)}`;

/** Creates the plan prices and the billing portal settings in Verexa HQ's Stripe account. Platform administrators only. */
export async function setUpBillingAction(form: FormData) {
  await requireAdmin();
  let target: string;
  try {
    const s = billingStripe();
    if (!s) throw new Error("Billing isn't configured: the Stripe billing key is missing.");
    if (s.livemode && form.get("live") !== "on") {
      target = go("error", "This is a LIVE Stripe key. Tick the box to confirm you want to create the live plans.");
    } else {
      const report = await runBillingSetup(billingSetupPort(s.stripe));
      const created = report.plans.filter((p) => p.status === "created").length;
      const wrong = report.plans.filter((p) => p.status === "wrong_amount").map((p) => p.lookupKey);
      target = wrong.length
        ? go("error", `Done, but ${wrong.join(", ")} already exist at a different price. Prices customers pay can't be edited; archive the old price in Stripe and run this again.`)
        : go("notice", `Done. ${created} plan price${created === 1 ? "" : "s"} created, ${report.plans.length - created} already existed. Billing portal settings ${report.portal}.`);
    }
  } catch (e) {
    unstable_rethrow(e);
    console.error(`billing setup failed: ${sanitizeError(e, 200)}`);
    target = go("error", explainStripeFailure(e as { type?: string; code?: string; message?: string; param?: string }));
  }
  revalidatePath(BASE);
  redirect(target);
}
