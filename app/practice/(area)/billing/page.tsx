import { Flash } from "@/components/admin/ui";
import { billingView } from "@/lib/billing/view.ts";
import { dollars, PAUSE_PLAN } from "@/lib/billing/plans.ts";
import { requirePractice } from "@/lib/practice/server";
import { tenantClient } from "@/lib/supabase/service";
import type { Subscription } from "@/lib/billing/access.ts";
import { openBillingPortalAction, pauseAction, reactivateAction, resumeAction } from "../../billing-actions";

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const sp = await searchParams;
  const ctx = await requirePractice();
  const { data } = await tenantClient(ctx.tenantId).from("tenant_subscriptions").select("*").maybeSingle();
  const view = billingView((data as Subscription | null) ?? null);
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
          <section className="monarch-panel" style={{ padding: 20 }}>
            <h2 style={{ marginTop: 0 }}>How it works</h2>
            <ul>
              <li>Your card is charged each month on the same date. If a payment fails, messages stop first, then the workspace becomes read-only, then it is cancelled.</li>
              <li>After cancelling, your data is kept for 90 days, then permanently deleted. You can come back any time before then.</li>
              <li>Pausing ({dollars(PAUSE_PLAN.priceCents)}/month) keeps your data from being deleted while you work with clients and contacts only.</li>
            </ul>
          </section>
        </>
      )}
    </>
  );
}
