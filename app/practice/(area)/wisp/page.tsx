import Link from "next/link";
import { Badge, Flash } from "@/components/admin/ui";
import { stripeClient } from "@/lib/admin";
import { LEGAL_PAGES_APPROVED } from "@/lib/legal";
import { requirePractice } from "@/lib/practice/server";
import { archiveIfLinked, openAnswers, reviewState, type PracticeWisp } from "@/lib/practice/wisp.ts";
import { practiceWispDeps } from "@/lib/practice/wisp-server";
import { confirmCheckoutFromStripe } from "@/lib/stripe-fulfillment";
import { BUILDER_FIELDS, BUILDER_STEPS, DISCLAIMER, PURCHASE_ACK, type BuilderField } from "@/lib/wisp/content.ts";
import { attestWispAction, buyWispAction, confirmReviewAction, generateWispAction, saveWispAction } from "@/app/practice/wisp-actions";

type Search = { notice?: string; error?: string; paid?: string; cancelled?: string };
const date = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso)) : "");

function Field({ f, value }: { f: BuilderField; value: string }) {
  const common = { id: f.id, name: f.id, required: f.required, defaultValue: value, placeholder: f.placeholder };
  return (
    <label className={f.type === "textarea" ? "is-wide" : undefined} htmlFor={f.id}>
      {f.label}{f.required ? " *" : ""}
      {f.type === "textarea" ? <textarea {...common} rows={4} maxLength={4000} />
        : f.type === "select" ? <select {...common}><option value="">Choose…</option>{f.options!.map((o) => <option key={o} value={o}>{o}</option>)}</select>
          : <input {...common} type={f.type === "number" ? "text" : f.type} inputMode={f.type === "number" ? "numeric" : undefined} maxLength={f.type === "number" ? 7 : 200} autoComplete="off" />}
    </label>
  );
}

export default async function PracticeWispPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requirePractice();
  const sp = await searchParams;
  const deps = practiceWispDeps(ctx.tenantId, ctx.userId);
  // Linked since the last visit: their own WISP is archived, and the office's covers them.
  await archiveIfLinked(deps, ctx.userId).catch(() => null);
  const linked = await deps.isLinked();
  let live = await deps.repo.getLive();
  // Back from checkout and the webhook is late: ask Stripe directly, the same way the webhook would be handled.
  const stripe = stripeClient();
  if (live?.status === "draft" && live.stripe_session_id && sp.paid && stripe) {
    try {
      if (await confirmCheckoutFromStripe(stripe, live.stripe_session_id)) live = await deps.repo.getLive();
    } catch (e) {
      console.error(`practice wisp: confirming payment failed: ${e instanceof Error ? e.message.slice(0, 160) : "unknown"}`);
    }
  }
  const history = (await deps.repo.list()).filter((w) => w.status === "archived");
  const saved = live ? openAnswers(deps, live) : {};
  const defaults: Record<string, string> = { owner_name: ctx.member.full_name, business_email: ctx.email, ...saved };
  const canBuy = LEGAL_PAGES_APPROVED && !!stripe;
  const review = live?.status === "active" ? reviewState(live, new Date()) : null;
  const editable = !linked && (!live || live.status === "draft" || live.status === "paid");

  return (
    <>
      <h1 className="office-h1">My WISP</h1>
      <Flash notice={sp.notice} error={sp.error} />
      <p className="monarch-muted">The FTC Safeguards Rule requires anyone who handles taxpayer data to keep a Written Information Security Plan. This one is written for a sole practitioner. {DISCLAIMER}</p>

      {linked && (
        <section className="monarch-panel" style={{ padding: 20 }}>
          <h2 style={{ marginTop: 0 }}>Covered by your ERO&apos;s WISP</h2>
          <p>You work in an ERO&apos;s office, so the office&apos;s WISP covers you. Acknowledge it in the <Link href="/office/compliance">office area</Link>. Your own WISP is kept below as history.</p>
        </section>
      )}

      {live?.status === "active" && (
        <section className="monarch-panel" style={{ padding: 20 }}>
          <h2 style={{ marginTop: 0 }}>Attested</h2>
          <p>{live.practice_name} · attested {date(live.attested_at)} by {live.attested_name}.</p>
          <p className="prep-status"><span>Next review due {date(live.review_due_on)}</span>{review && <Badge value={review.state === "overdue" ? "overdue" : review.state === "due_soon" ? "due_soon" : "current"} />}{review && review.state !== "not_due" && <span className="monarch-muted">{review.state === "overdue" ? `${-review.daysLeft} day${review.daysLeft === -1 ? "" : "s"} late. Nothing is locked; review it when you can.` : `${review.daysLeft} day${review.daysLeft === 1 ? "" : "s"} left.`}</span>}</p>
          <p><Link className="monarch-secondary" href="/practice/wisp/download">Download my WISP (PDF)</Link></p>
          <h3>Annual review</h3>
          <p className="monarch-muted">Read your plan, update anything that has changed, then confirm. Type your name to confirm: {live.holder_name}.</p>
          <form action={confirmReviewAction} className="monarch-inline-form"><input name="name" placeholder="Your full name" aria-label="Your full name" required maxLength={200} autoComplete="off" /><button className="monarch-primary">Confirm review</button></form>
        </section>
      )}

      {live && live.status === "paid" && (
        <section className="monarch-panel" style={{ padding: 20 }}>
          <h2 style={{ marginTop: 0 }}>{live.pdf_path ? "Read it, then attest" : "Paid. Make your WISP"}</h2>
          {!live.pdf_path ? (
            <form action={generateWispAction}><p>Your answers are saved and the WISP is paid for. Generate it now; you can still change your answers below first.</p><button className="monarch-primary">Generate my WISP</button></form>
          ) : (
            <>
              <p><Link className="monarch-secondary" href="/practice/wisp/download">Read my WISP (PDF)</Link></p>
              <p className="monarch-muted">Attesting means you have read the plan and adopt it as your information security program. Type your name to attest: {live.holder_name}.</p>
              <form action={attestWispAction} className="monarch-inline-form"><input name="name" placeholder="Your full name" aria-label="Your full name" required maxLength={200} autoComplete="off" /><button className="monarch-primary">Attest</button></form>
            </>
          )}
        </section>
      )}

      {editable && (
        <section className="monarch-panel" style={{ padding: 20 }}>
          <h2 style={{ marginTop: 0 }}>{live ? "Your answers" : "Build your WISP"}</h2>
          <form action={saveWispAction} className="monarch-form">
            {(Object.keys(BUILDER_FIELDS) as (keyof typeof BUILDER_FIELDS)[]).map((k) => (
              <fieldset key={k} className="is-wide wisp-step"><legend>{BUILDER_STEPS.find((s) => s.id === k)?.title}</legend>
                <div className="monarch-form">{BUILDER_FIELDS[k].map((f) => <Field key={f.id} f={f} value={defaults[f.id] ?? ""} />)}</div>
              </fieldset>
            ))}
            <div className="is-wide"><button className="monarch-primary">{live ? "Save changes" : "Save my answers"}</button></div>
          </form>
        </section>
      )}

      {live?.status === "draft" && !linked && (
        <section className="monarch-panel" style={{ padding: 20 }}>
          <h2 style={{ marginTop: 0 }}>Get your WISP: $25</h2>
          {sp.cancelled && <p className="monarch-muted">Checkout was cancelled. Nothing was charged.</p>}
          {sp.paid && <p className="monarch-muted">Waiting for the payment to clear. Refresh in a moment.</p>}
          {canBuy ? (
            <form action={buyWispAction} className="monarch-form">
              <label className="is-wide"><input type="checkbox" name="ack" value="yes" required /> {PURCHASE_ACK}</label>
              <label className="is-wide"><input type="checkbox" name="terms" value="yes" required /> I accept the Terms of Service and the Refund Policy.</label>
              <div className="is-wide"><button className="monarch-primary">Pay $25 and continue</button></div>
            </form>
          ) : <p className="monarch-muted">Online checkout isn&apos;t available yet. Please contact us to get your WISP.</p>}
        </section>
      )}

      {history.length > 0 && (
        <section className="monarch-panel" style={{ padding: 20 }}>
          <h2 style={{ marginTop: 0 }}>History</h2>
          <ul>{history.map((w: PracticeWisp) => <li key={w.id}>{w.practice_name} · attested {date(w.attested_at) || "never"} · archived {date(w.archived_at)} (linked to an ERO) — kept as a record</li>)}</ul>
        </section>
      )}
    </>
  );
}
