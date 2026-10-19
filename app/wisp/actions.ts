"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { appOrigin, commerceRepo, stripeClient } from "@/lib/admin";
import { clientAddress, hashClient } from "@/lib/commerce/rate-limit.ts";
import { startStorefrontCheckout } from "@/lib/commerce/storefront-checkout.ts";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { LEGAL_PAGES_APPROVED, LEGAL_VERSION } from "@/lib/legal";
import { rateLimitStore } from "@/lib/rate-limit-server";
import { stripeCatalogPort, stripeStorefrontSessions } from "@/lib/stripe-catalog";
import { MONARCH_TENANT_ID } from "@/lib/tenants";
import { attachCheckout, planForBuyer, recordAudit, resendForBuyer, startPlan } from "@/lib/wisp/service.ts";
import { requestTenant, wispDeps } from "@/lib/wisp/server";
import { WISP_COOKIE } from "@/lib/wisp/cookie.ts";
import { captureAuditLead, captureAuditStart, captureBuilderStart, LeadInputError } from "@/lib/leads/service.ts";
import { leadsDeps } from "@/lib/leads/server";

// Public WISP Generator actions. The tenant comes from the web address the page was opened on. Every action is
// limited per visitor; answers are checked again on the server.

const WISP_SLUG = "wisp-assisted-build";

async function visitor(kind: "audit" | "start" | "checkout" | "resend", limit: number) {
  const h = await headers();
  const ip = clientAddress(h.get("x-forwarded-for"));
  const ipHash = ip ? hashClient(ip, process.env.MONARCH_ENCRYPTION_KEY) : null;
  const hour = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000).toISOString();
  if (ipHash && (await rateLimitStore().hit(`wisp:${kind}:ip:${ipHash}`, hour).catch(() => 0)) > limit) {
    throw new ValidationError("Too many attempts from your connection. Please wait a while and try again.");
  }
  return { ipHash: ipHash ? ipHash.slice(0, 32) : null, userAgent: h.get("user-agent")?.slice(0, 300) ?? null };
}

const failure = (e: unknown, what: string) => {
  if (e instanceof ValidationError) return e.message;
  console.error(`wisp ${what} failed: ${e instanceof Error ? e.message.slice(0, 160) : "unknown"}`);
  return "Something went wrong on our side. Your answers are still on this page; please try again in a minute.";
};

export type StartResult = { ok: true } | { ok: false; error: string; field?: "name" | "email" | "phone" };

/**
 * The audit's first step: name, email and phone. Saves the visitor as a lead (source WISP audit) before the questions.
 * A problem on our side never keeps them from the audit (it is logged); a typing mistake is shown on the form.
 */
export async function startAuditAction(input: { name: unknown; email: unknown; phone: unknown }): Promise<StartResult> {
  try {
    await visitor("start", 20);
    await captureAuditStart(leadsDeps(await requestTenant()), input);
    return { ok: true };
  } catch (e) {
    const field = e instanceof LeadInputError && (e.field === "name" || e.field === "email" || e.field === "phone") ? e.field : undefined;
    const error = failure(e, "start");
    if (!(e instanceof ValidationError)) return { ok: true };
    return { ok: false, error, field };
  }
}

/**
 * The builder's first step: business name, email and phone are saved as a lead (source WISP builder) before the rest
 * of the questions, so an abandoned builder is still a lead. A problem on our side never stops them; a typing mistake
 * is shown on the form.
 */
export async function startBuilderAction(input: { name: unknown; email: unknown; phone: unknown }): Promise<StartResult> {
  try {
    await visitor("start", 20);
    await captureBuilderStart(leadsDeps(await requestTenant()), input);
    return { ok: true };
  } catch (e) {
    const field = e instanceof LeadInputError && (e.field === "name" || e.field === "email" || e.field === "phone") ? e.field : undefined;
    const error = failure(e, "builder start");
    if (!(e instanceof ValidationError)) return { ok: true };
    return { ok: false, error, field };
  }
}

/**
 * Saves the finished audit and puts its score on the visitor's lead. Never blocks the results: a problem is logged.
 */
export async function recordAuditAction(input: { answers: unknown; ero: unknown; lead?: { name: unknown; email: unknown; phone: unknown } }): Promise<{ ok: true; auditId: string } | { ok: false }> {
  try {
    const who = await visitor("audit", 30);
    const tenantId = await requestTenant();
    const r = await recordAudit(wispDeps(tenantId), input, who);
    if (input.lead) await captureAuditLead(leadsDeps(tenantId), input.lead, { id: r.auditId, score: r.score }).catch((e: unknown) => failure(e, "audit lead"));
    return { ok: true, auditId: r.auditId };
  } catch (e) {
    failure(e, "audit");
    return { ok: false };
  }
}

export type CheckoutResult = { ok: false; error: string; field?: string };

/**
 * The review step's "Complete My WISP — $25". Saves the answers and email first (a lead even if they don't pay), then
 * starts the Stripe checkout for the WISP product. The PDF is made only after the webhook confirms payment.
 */
export async function startWispCheckoutAction(input: { answers: unknown; email: unknown; auditId: unknown; acceptTerms: boolean; acknowledgePurchase: boolean }): Promise<CheckoutResult> {
  let url: string;
  try {
    await visitor("checkout", 10);
    const tenantId = await requestTenant();
    if (input.acknowledgePurchase !== true) throw new ValidationError("Please tick the box to confirm you understand the purchase terms.");
    if (!input.acceptTerms) throw new ValidationError("Please confirm that you accept the Terms of Service and the Refund Policy.");
    const stripe = stripeClient();
    const catalog = stripeCatalogPort();
    // The storefront and its Stripe account are Monarch's; other firms' WISP builders can't take payment yet.
    if (!stripe || !catalog || !LEGAL_PAGES_APPROVED || tenantId !== MONARCH_TENANT_ID) throw new ValidationError("Online checkout is not available yet. Please contact us to get your WISP.");
    const deps = wispDeps(tenantId);
    const { plan, accessToken } = await startPlan(deps, { answers: input.answers, email: input.email, auditId: input.auditId });
    const checkout = await startStorefrontCheckout(commerceRepo(), catalog, stripeStorefrontSessions(stripe), {
      slug: WISP_SLUG,
      installationType: null,
      termsAccepted: true,
      termsVersion: LEGAL_VERSION,
      origin: (await appOrigin()).replace(/\/$/, ""),
      // The buyer ticked the purchase acknowledgement (all sales final, not legal advice); kept on the Stripe session.
      extraMetadata: { wisp_plan_id: plan.id, wisp_purchase_ack: "yes" },
      successPath: "/wisp/done",
      cancelPath: "/wisp?cancelled=1#builder",
    });
    await attachCheckout(deps, plan.id, checkout.sessionId);
    (await cookies()).set(WISP_COOKIE, `${plan.id}.${accessToken}`, { httpOnly: true, secure: true, sameSite: "lax", path: "/wisp", maxAge: 60 * 60 * 24 * 30 });
    url = checkout.url;
  } catch (e) {
    const field = e instanceof ValidationError && /email/i.test(e.message) ? "delivery_email" : undefined;
    return { ok: false, error: failure(e, "checkout"), field };
  }
  redirect(url);
}

/** The confirmation page's "Email it again". */
export async function resendWispAction(): Promise<void> {
  let notice = "sent";
  try {
    await visitor("resend", 10);
    const deps = wispDeps(await requestTenant());
    const [planId, token] = ((await cookies()).get(WISP_COOKIE)?.value ?? "").split(".");
    const plan = planId && token ? await planForBuyer(deps, planId, token) : null;
    if (!plan) throw new ValidationError("We couldn't find your WISP in this browser. Use the link in your email, or contact us.");
    const after = await resendForBuyer(deps, plan);
    notice = after.emailed_at && !after.email_error ? "sent" : "failed";
  } catch (e) {
    redirect(`/wisp/done?error=${encodeURIComponent(failure(e, "resend"))}`);
  }
  redirect(`/wisp/done?resent=${notice}`);
}
