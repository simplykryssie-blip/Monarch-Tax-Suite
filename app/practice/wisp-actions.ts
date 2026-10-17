"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { appOrigin, commerceRepo, stripeClient } from "@/lib/admin";
import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { startStorefrontCheckout } from "@/lib/commerce/storefront-checkout.ts";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { LEGAL_PAGES_APPROVED, LEGAL_VERSION } from "@/lib/legal";
import { requirePractice } from "@/lib/practice/server";
import { attachCheckout, attest, confirmReview, generate, saveDraft } from "@/lib/practice/wisp.ts";
import { practiceWispDeps } from "@/lib/practice/wisp-server";
import { stripeCatalogPort, stripeStorefrontSessions } from "@/lib/stripe-catalog";
import { PURCHASE_ACK } from "@/lib/wisp/content.ts";

// The independent PTIN holder's WISP: build the plan, buy the $25 WISP product, generate it, attest, review each year.
// Each action re-checks who is signed in (two-step included) and acts only on that holder's own workspace.

const WISP_SLUG = "wisp-assisted-build";
const PATH = "/practice/wisp";
const str = (form: FormData, k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string) : "");
const to = (key: "notice" | "error", message: string) => `${PATH}?${key}=${encodeURIComponent(message)}`;
const failure = (e: unknown) => {
  if (e instanceof ValidationError) return e.message;
  console.error(`practice wisp action failed: ${sanitizeError(e, 200)}`);
  if (/relation|schema cache|does not exist/i.test(e instanceof Error ? e.message : "")) return "The WISP isn't installed yet. Apply the independent WISP migration first.";
  return "That did not work. Nothing was changed. Please try again.";
};

async function act(fn: (ctx: Awaited<ReturnType<typeof requirePractice>>) => Promise<{ notice: string; to?: string }>) {
  const ctx = await requirePractice();
  let target: string;
  try {
    const r = await fn(ctx);
    target = r.to ?? to("notice", r.notice);
  } catch (e) {
    unstable_rethrow(e);
    target = to("error", failure(e));
  }
  revalidatePath(PATH);
  redirect(target);
}

export async function saveWispAction(form: FormData) {
  await act(async (ctx) => {
    await saveDraft(practiceWispDeps(ctx.tenantId, ctx.userId), ctx.userId, ctx.member.full_name, Object.fromEntries([...form.entries()].filter(([k, v]) => typeof v === "string" && k !== "area")));
    return { notice: "Saved." };
  });
}

/** Starts checkout for the $25 WISP product (sold by the platform); the holder's WISP is marked paid when it clears. */
export async function buyWispAction(form: FormData) {
  await act(async (ctx) => {
    if (str(form, "ack") !== "yes") throw new ValidationError("Please tick the box to confirm you understand the purchase terms.");
    if (str(form, "terms") !== "yes") throw new ValidationError("Please confirm that you accept the Terms of Service and the Refund Policy.");
    const stripe = stripeClient();
    const catalog = stripeCatalogPort();
    if (!stripe || !catalog || !LEGAL_PAGES_APPROVED) throw new ValidationError("Online checkout is not available yet. Please contact us to get your WISP.");
    const deps = practiceWispDeps(ctx.tenantId, ctx.userId);
    const w = await deps.repo.getLive();
    if (!w) throw new ValidationError("Save your answers first.");
    if (w.status !== "draft") throw new ValidationError("This WISP is already paid for.");
    if (await deps.isLinked()) throw new ValidationError("You work in an ERO's office, so the office's WISP covers you.");
    const checkout = await startStorefrontCheckout(commerceRepo(), catalog, stripeStorefrontSessions(stripe), {
      slug: WISP_SLUG, installationType: null, termsAccepted: true, termsVersion: LEGAL_VERSION,
      origin: (await appOrigin()).replace(/\/$/, ""),
      extraMetadata: { practice_tenant_id: ctx.tenantId, practice_wisp_id: w.id, wisp_purchase_ack: "yes", purchase_ack_text: PURCHASE_ACK.slice(0, 120) },
      successPath: `${PATH}?paid=1`, cancelPath: `${PATH}?cancelled=1`,
    });
    await attachCheckout(deps, w.id, checkout.sessionId);
    return { notice: "", to: checkout.url };
  });
}

export async function generateWispAction() {
  await act(async (ctx) => {
    await generate(practiceWispDeps(ctx.tenantId, ctx.userId), ctx.userId);
    return { notice: "Your WISP is ready. Read it, then attest." };
  });
}

export async function attestWispAction(form: FormData) {
  await act(async (ctx) => {
    await attest(practiceWispDeps(ctx.tenantId, ctx.userId), ctx.userId, form.get("name"));
    return { notice: "Attested. Your first annual review is due in 12 months; you'll be reminded." };
  });
}

export async function confirmReviewAction(form: FormData) {
  await act(async (ctx) => {
    await confirmReview(practiceWispDeps(ctx.tenantId, ctx.userId), ctx.userId, form.get("name"));
    return { notice: "Review confirmed. The next one is due in 12 months." };
  });
}
