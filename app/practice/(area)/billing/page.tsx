import { Flash } from "@/components/admin/ui";
import { billingView } from "@/lib/billing/view.ts";
import { dollars, PAUSE_PLAN, PLANS, switchablePlans } from "@/lib/billing/plans.ts";
import { billingDeps } from "@/lib/billing/server";
import { previewPlanChange, type PlanChangePreview } from "@/lib/billing/service.ts";
import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { requirePractice } from "@/lib/practice/server";
import { tenantClient } from "@/lib/supabase/service";
import type { Subscription } from "@/lib/billing/access.ts";
import { changePlanAction, openBillingPortalAction, pauseAction, previewPlanChangeAction, reactivateAction, resumeAction } from "../../billing-actions";

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string; change?: string }> }) {
  const sp = await searchParams;
  const ctx = await requirePractice();
  const { data } = await tenantClient(ctx.tenantId).from("tenant_subscriptions").select("*").maybeSingle();
  const sub = (data as Subscription | null) ?? null;
  const view = billingView(sub);
  // A plan change the owner is looking at: what they would pay today, before they confirm.
  let preview: PlanChangePreview | null = null;
  let previewError: string | null = null;
  if (sub && view?.can.changePlan && sp.change) {
    try {
      const deps = billingDeps();
      if (!deps) throw new Error("unavailable");
      preview = await previewPlanChange(deps, ctx.tenantId, sp.change);
    } catch (e) {
      console.error(`billing plan preview failed: ${sanitizeError(e, 240)}`);
      previewError = e instanceof Error && e.name === "ValidationError" ? e.message : "We couldn't work out the cost just now. Please try again.";
    }
  }
  return (
    <>
      <h1 className="office-h1">Billing</h1>
      <Flash notice={sp.notice} error={sp.error} />
      {!view ? (
        <section className="monarch-panel" style={{ padding: 20 }}>
          <p>This workspace isn&apos;t billed through Verexa HQ, so there&apos;s nothing to manage here.</p>
        </section>
      ) : (
        <>
          <section className="monarch-panel" style={{ padding: 20 }}>
            <dl className="su-summary">
              <dt>Plan</dt><dd>{view.planLabel}</dd>
              <dt>Price</dt><dd>{view.price} per month</dd>
              <dt>Status</dt><dd>{view.statusLabel}</dd>
              {view.renews && (<><dt>Next payment</dt><dd>{view.renews}</dd></>)}
            </dl>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {view.can.portal && <form action={openBillingPortalAction}><button className="monarch-primary">Update card, invoices and cancel</button></form>}
              {view.can.pause && <form action={pauseAction}><button className="monarch-secondary">Pause for {dollars(PAUSE_PLAN.priceCents)}/month</button></form>}
              {view.can.resume && <form action={resumeAction}><button className="monarch-primary">Resume my plan</button></form>}
              {view.can.reactivate && <form action={reactivateAction}><button className="monarch-primary">Reactivate my account</button></form>}
            </div>
          </section>
          {sub && view.can.changePlan && (
            <section className="monarch-panel" style={{ padding: 20 }}>
              <h2 style={{ marginTop: 0 }}>Change plan</h2>
              {preview ? (
                <>
                  <p>Switching to <b>{PLANS[preview.to].label}</b> ({dollars(PLANS[preview.to].priceCents)} per month) starts today and your monthly billing date becomes today&apos;s date. You get credit for the unused days of your current plan{preview.creditCents > 0 ? ` (${dollars(preview.creditCents)})` : ""}, so you pay <b>{dollars(preview.dueCents)}</b> today. This price holds for 30 minutes.</p>
                  <form action={changePlanAction} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <input type="hidden" name="plan" value={preview.to} />
                    <input type="hidden" name="proration_date" value={preview.prorationDate} />
                    <button className="monarch-primary">Confirm and pay {dollars(preview.dueCents)}</button>
                    <a className="monarch-secondary" href="/practice/billing">Not now</a>
                  </form>
                </>
              ) : (
                <form action={previewPlanChangeAction} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
                  <label>Move to
                    <select name="plan" defaultValue="">
                      <option value="" disabled>Choose a plan…</option>
                      {switchablePlans(sub.plan).map((p) => <option key={p.key} value={p.key}>{p.label} ({dollars(p.priceCents)}/month)</option>)}
                    </select>
                  </label>
                  <button className="monarch-secondary">See what I&apos;d pay</button>
                </form>
              )}
              {previewError && <p className="monarch-alert is-error" role="alert">{previewError}</p>}
            </section>
          )}
          <section className="monarch-panel" style={{ padding: 20 }}>
            <h2 style={{ marginTop: 0 }}>How it works</h2>
            <ul>
              <li>Your card is charged each month on the same date. If a payment fails, your workspace becomes read-only right away (you can still use this Billing page), we keep trying and send reminders, and if it isn&apos;t paid within 14 days the account is cancelled.</li>
              <li>If you change plan, the new plan starts today and the unused part of your old plan is credited toward it.</li>
              <li>After cancelling, your data is kept for 90 days, then permanently deleted. You can come back any time before then.</li>
              <li>Pausing ({dollars(PAUSE_PLAN.priceCents)}/month) keeps your data from being deleted while you work with clients and contacts only.</li>
            </ul>
          </section>
        </>
      )}
    </>
  );
}
