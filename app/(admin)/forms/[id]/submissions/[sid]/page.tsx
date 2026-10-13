import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { formDeps } from "@/lib/forms/server";
import { displayAnswer, recordView, seenFieldIds } from "@/lib/forms/service.ts";
import { DISPLAY_TYPES } from "@/lib/forms/definition.ts";
import { REVIEW_STATUSES, type StoredAnswers } from "@/lib/forms/types.ts";
import { formatInZone } from "@/lib/documents/signing.ts";
import { Badge, Flash, PageTitle, when } from "@/components/admin/ui";
import { FormTabs, formsLoad, FormsSetupRequired } from "@/components/forms/admin-bits";
import { RevealAnswer } from "@/components/forms/reveal-answer";
import { relinkCustomerAction, remakePdfAction, retryFirmAction, submissionStatusAction } from "../../../actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EVENT_LABELS: Record<string, string> = {
  submitted: "Submitted", spam: "Marked as spam", pdf_made: "PDF made", pdf_remade: "PDF made again", notified: "Firm notified", confirmation_sent: "Confirmation emailed to the respondent",
  customer_linked: "Linked to the customer", customer_created: "Customer created", firm_created: "Firm created in My Service Bureau", firm_linked: "Linked to an existing firm",
  firm_failed: "Firm record not made", relink_requested: "Customer link requested", viewed: "Viewed", revealed: "Sensitive answer shown", file_viewed: "File opened", pdf_downloaded: "PDF downloaded", status_changed: "Status changed", draft_saved: "Saved for later",
};

export default async function SubmissionPage({ params, searchParams }: { params: Promise<{ id: string; sid: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  const admin = await requireAdmin();
  const { id, sid } = await params;
  const { notice, error } = await searchParams;
  if (!UUID.test(id) || !UUID.test(sid)) notFound();
  const result = await formsLoad(async () => {
    const deps = formDeps();
    const [form, sub] = await Promise.all([deps.repo.getForm(id), deps.repo.getSubmission(sid)]);
    if (!form || !sub || sub.form_id !== form.id || sub.status === "draft") return null;
    const [version, uploads, events, profile] = await Promise.all([deps.repo.getVersion(sub.version_id), deps.repo.listUploads(sub.id), deps.repo.listEvents(sub.id, 100), deps.profile()]);
    return { deps, form, sub, version, uploads, events, tz: profile?.time_zone ?? "America/New_York" };
  });
  if (!result.ok) return <FormsSetupRequired message={result.message} />;
  if (!result.data) notFound();
  const { deps, form, sub, version, uploads, events, tz } = result.data;
  after(() => recordView(deps, sub, admin.userId).catch(() => undefined));
  const answers = sub.answers as StoredAnswers;
  // Unanswered questions the respondent saw are listed as "no answer"; hidden and skipped ones are not.
  const seen = version ? seenFieldIds(version.definition, answers) : new Set<string>();
  const stamp = (iso: string | null) => (iso ? formatInZone(new Date(iso), tz) : "—");
  return (
    <>
      <PageTitle title={`Submission #${sub.number}`} back={{ href: `/forms/${form.id}/submissions`, label: form.name }}>
        <Badge value={sub.status} />{sub.is_test ? " · TEST" : ""} · Submitted {stamp(sub.submitted_at)} · Started {stamp(sub.started_at)} · Form version {version?.version ?? "?"}
      </PageTitle>
      <Flash notice={notice} error={error} />
      <FormTabs form={form} active="submissions" />
      <div className="monarch-lower-grid">
        <section className="monarch-panel" style={{ padding: 20 }}>
          <h2>Answers</h2>
          {sub.spam_reason && <p className="monarch-alert is-error">Marked as spam: {sub.spam_reason}.</p>}
          {version?.definition.pages.map((p) => p.sections.map((s) => {
            const rows = s.fields.filter((f) => !DISPLAY_TYPES.includes(f.type) && f.type !== "signature" && (answers[f.key] !== undefined || seen.has(f.id)));
            if (!rows.length) return null;
            return (
              <div key={s.id} style={{ marginBottom: 16 }}>
                {(s.title || p.title) && <h3 style={{ margin: "8px 0" }}>{s.title || p.title}</h3>}
                <dl className="monarch-dl">
                  {rows.map((f) => {
                    const v = answers[f.key];
                    const sealed = v && typeof v === "object" && !Array.isArray(v) && "sealed" in v;
                    return (
                      <div key={f.id} style={{ display: "contents" }}>
                        <dt>{f.label || f.key}</dt>
                        <dd style={{ whiteSpace: "pre-wrap" }}>
                          {sealed ? <RevealAnswer submissionId={sub.id} fieldKey={f.key} masked={displayAnswer(f, v)} /> : f.type === "file" && Array.isArray(v) ? (
                            (v as string[]).map((uid) => { const u = uploads.find((x) => x.id === uid); return u ? <span key={uid} style={{ display: "block" }}><a href={`/forms/files/${u.id}`} target="_blank" rel="noreferrer">{u.file_name}</a> <small className="monarch-muted">{Math.max(1, Math.round(u.size_bytes / 1024))} KB · SHA-256 {u.sha256?.slice(0, 16)}…</small></span> : null; })
                          ) : v === undefined ? <span className="monarch-muted">(no answer)</span> : displayAnswer(f, v, uploads)}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </div>
            );
          }))}
          {sub.signature && (
            <div>
              <h3>Signature</h3>
              <p>{sub.signature.method === "drawn" ? "Drawn" : "Typed"} by <b>{sub.signature.signed_name}</b> on {stamp(sub.consented_at)}{sub.signature.method === "typed" ? `: “${sub.signature.typed}”` : ""}.{" "}
                {sub.signature.upload_id && <a href={`/forms/files/${sub.signature.upload_id}`} target="_blank" rel="noreferrer">View the drawn signature</a>}</p>
              <details><summary>Consent text the signer agreed to</summary><p style={{ whiteSpace: "pre-wrap" }}>{sub.consent_text}</p></details>
              <p className="monarch-muted">Network address (one-way hash): {sub.ip_hash ?? "not available"} · Browser: {sub.user_agent ?? "not available"}</p>
            </div>
          )}
        </section>
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <section className="monarch-panel" style={{ padding: 20 }}>
            <h2>Record</h2>
            <p>PDF: {sub.pdf_path ? <><a className="monarch-primary" href={`/forms/pdf/${sub.id}`} style={{ textDecoration: "none" }}>Download PDF</a> <small className="monarch-subcell">SHA-256 {sub.pdf_sha256}</small></> : <>still being made{sub.pdf_error ? ` (last try: ${sub.pdf_error})` : ""}</>}</p>
            <form action={remakePdfAction}><input type="hidden" name="id" value={sub.id} /><input type="hidden" name="form_id" value={form.id} /><button className="monarch-link">{sub.pdf_path ? "Make the PDF again" : "Make the PDF now"}</button></form>
            <p>Respondent: {sub.respondent_name ?? "—"} {sub.respondent_email ? `<${sub.respondent_email}>` : ""}</p>
            <p>Customer: {sub.customer_id ? <Link href={`/customers/${sub.customer_id}`}>Open the customer</Link> : sub.is_test ? "not linked (test)" : "not linked"}</p>
            {!sub.is_test && !sub.customer_id && sub.status !== "spam" && (
              <form action={relinkCustomerAction}><input type="hidden" name="id" value={sub.id} /><input type="hidden" name="form_id" value={form.id} /><button className="monarch-link">Link the customer now (from the email answer)</button></form>
            )}
            <p>Firm: {sub.organization_id ? <Link href={`/efin/org/${sub.organization_id}`}>{sub.firm_status === "created" ? "Created in My Service Bureau" : "Linked to an existing firm"}</Link> : sub.firm_status === "failed" ? <span className="mf-error">Not made: {sub.firm_error}</span> : "—"}</p>
            {!sub.is_test && !sub.organization_id && sub.status !== "spam" && (
              <form action={retryFirmAction}><input type="hidden" name="id" value={sub.id} /><input type="hidden" name="form_id" value={form.id} /><button className="monarch-link">Create or link the firm now</button></form>
            )}
            <p>Firm notified: {sub.notified_at ? stamp(sub.notified_at) : sub.notify_error ? `not yet (${sub.notify_error})` : "—"} · Confirmation: {sub.confirmation_sent_at ? stamp(sub.confirmation_sent_at) : "—"}</p>
            <form action={submissionStatusAction} className="monarch-inline-form">
              <input type="hidden" name="id" value={sub.id} /><input type="hidden" name="form_id" value={form.id} />
              <select name="status" defaultValue={sub.status} aria-label="Status">{REVIEW_STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</select>
              <button className="monarch-secondary">Set status</button>
            </form>
          </section>
          <section className="monarch-panel" style={{ padding: 20 }}>
            <h2>History</h2>
            <ul style={{ paddingLeft: 18, margin: 0 }}>
              {events.map((e) => <li key={e.id} style={{ marginBottom: 4 }}>{EVENT_LABELS[e.type] ?? e.type} · {when(e.created_at)}{e.actor_id ? " · by an administrator" : ""}{e.type === "status_changed" ? ` (${String(e.detail.from)} → ${String(e.detail.to)})` : ""}</li>)}
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
