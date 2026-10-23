import type { Metadata } from "next";
import { cookies } from "next/headers";
import { confirmCheckoutFromStripe } from "@/lib/stripe-fulfillment";
import { MONARCH_TENANT_ID } from "@/lib/tenants";
import { DISCLAIMER, DONE_DISCLAIMER } from "@/lib/wisp/content.ts";
import { deliver, planForBuyer, type WispPlan } from "@/lib/wisp/service.ts";
import { requestTenant, wispDeps } from "@/lib/wisp/server";
import { WISP_COOKIE } from "@/lib/wisp/cookie.ts";
import { resendWispAction } from "../actions";
import { storeStripeClient } from "@/lib/store-stripe/server";

export const metadata: Metadata = { title: "Your WISP", robots: { index: false, follow: false } };

/**
 * After checkout. Payment is confirmed by Stripe's webhook, usually within seconds; this page waits for it, makes
 * sure the PDF exists (making it here if the webhook's attempt failed), and always offers the download.
 */
/**
 * While the plan still shows unpaid, asks Stripe directly and records a finished payment the same way the webhook
 * does, so the buyer isn't left waiting when the webhook is late or can't reach this deployment.
 */
async function confirmPayment(deps: ReturnType<typeof wispDeps>, plan: WispPlan | null): Promise<WispPlan | null> {
  const stripe = await storeStripeClient();
  if (!plan || plan.status !== "draft" || !plan.stripe_session_id || plan.tenant_id !== MONARCH_TENANT_ID || !stripe) return plan;
  try {
    if (!(await confirmCheckoutFromStripe(stripe, plan.stripe_session_id))) return plan;
    return (await deps.repo.getPlan(plan.id)) ?? plan;
  } catch (e) {
    console.error(`wisp done: confirming payment for ${plan.id} failed: ${e instanceof Error ? e.message.slice(0, 200) : "unknown"}`);
    return plan;
  }
}

/** Makes the PDF and sends the email if the webhook couldn't (both are safe to repeat). */
async function finish(plan: WispPlan | null): Promise<{ plan: WispPlan | null; problem: string | null }> {
  if (!plan || plan.status === "draft" || (plan.pdf_path && (plan.emailed_at || plan.email_error))) return { plan, problem: null };
  const deps = wispDeps(plan.tenant_id);
  try {
    return { plan: await deliver(deps, plan, "buyer"), problem: null };
  } catch (e) {
    const problem = e instanceof Error ? e.message.slice(0, 200) : "unknown";
    console.error(`wisp done: delivery for ${plan.id} failed: ${problem}`);
    return { plan, problem };
  }
}

export default async function WispDonePage({ searchParams }: { searchParams: Promise<{ resent?: string; error?: string }> }) {
  const { resent, error } = await searchParams;
  const deps = wispDeps(await requestTenant());
  const [planId, token] = ((await cookies()).get(WISP_COOKIE)?.value ?? "").split(".");
  const found = planId && token ? await planForBuyer(deps, planId, token).catch(() => null) : null;
  const { plan, problem } = await finish(await confirmPayment(deps, found));
  const waiting = plan?.status === "draft";
  const emailFailed = !!plan && plan.status !== "draft" && !plan.emailed_at && !!plan.email_error;
  return (
    <div className="wisp">
      {waiting && <meta httpEquiv="refresh" content="4" />}
      <section className="section">
        <div className="container" style={{ maxWidth: 720 }}>
          <div className="builder-main">
            {!plan ? (
              <div className="delivery-status">
                <h3>We couldn&apos;t find your WISP in this browser</h3>
                <p>If you paid, your WISP is on its way to your email, with a download link. Open it from the browser you paid in, or use the link in the email.</p>
              </div>
            ) : waiting ? (
              <div className="delivery-status">
                <div className="spinner" />
                <h3>Confirming your payment…</h3>
                <p>This usually takes a few seconds. This page updates on its own.</p>
              </div>
            ) : (
              <div className="delivery-status">
                <div className="check-icon">✓</div>
                <h3>Your WISP is ready</h3>
                <p>Your Written Information Security Plan for <strong style={{ color: "#FCF6BA" }}>{plan.firm_name}</strong> has been generated.</p>
                {error && <p className="alert" role="alert">{error}</p>}
                {resent === "sent" && <p className="notice">Sent again to {plan.email}.</p>}
                {emailFailed ? (
                  <p className="alert" role="alert">We couldn&apos;t email it to {plan.email} just now. Download it below, and try sending it again.</p>
                ) : plan.emailed_at ? (
                  <p>A copy was emailed to <strong style={{ color: "#FCF6BA" }}>{plan.email}</strong>, with a link that works for a year.</p>
                ) : null}
                {problem && !plan.pdf_path && <p className="alert" role="alert">Your WISP is taking longer than usual to prepare. Refresh this page in a minute.</p>}
                <div className="delivery-actions">
                  {plan.pdf_path && <a className="btn btn-gold btn-lg" href="/wisp/download">Download My WISP (PDF)</a>}
                  <form action={resendWispAction}><button className="btn btn-outline">{emailFailed ? "Try emailing it again" : "Email it to me again"}</button></form>
                </div>
                <p className="done-disclaimer">{DONE_DISCLAIMER}</p>
                <p className="fine-print">{DISCLAIMER}</p>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
