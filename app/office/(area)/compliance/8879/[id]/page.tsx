import { notFound } from "next/navigation";
import { Flash } from "@/components/admin/ui";
import { ActionForm } from "@/app/(admin)/efin/action-form";
import { earlyDeletion, retentionState, settingsOf, todayIso } from "@/lib/compliance/rules.ts";
import { UUID } from "@/lib/compliance/service.ts";
import { delete8879Action, update8879Action } from "../../actions";
import { ComplianceTabs, compliancePage, day, loadOr, SetupNotice, stamp } from "../../parts";
import { Fields8879 } from "../fields";

export default async function Record8879({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  const { ctx, deps, may } = await compliancePage("compliance.8879");
  const { id } = await params;
  const sp = await searchParams;
  if (!UUID.test(id)) notFound();
  const result = await loadOr(async () => {
    const r = await deps.repo.get8879(id);
    if (!r || r.organization_id !== ctx.officeId) return null;
    const [files, events, settings] = await Promise.all([may("compliance.vault") ? deps.repo.listDocuments(ctx.officeId, { kind: "8879" }) : [], deps.repo.listEvents(ctx.officeId, { entity: "8879", recordId: id }), deps.repo.getSettings(ctx.officeId)]);
    return { r, files, events, settings: settingsOf(settings) };
  });
  if (!result.ok) return <SetupNotice message={result.message} />;
  if (!result.data) notFound();
  const { r, files, events, settings } = result.data;
  const today = todayIso();
  const early = earlyDeletion(r.retention_until, today);
  const st = retentionState(r.retention_until, today, settings.retention_alert_days);
  return (
    <>
      <h1 className="office-h1">8879 · {r.return_ref}</h1>
      <ComplianceTabs may={may} active="/office/compliance/8879" />
      <Flash notice={sp.notice} error={sp.error} />
      <section className="monarch-panel" style={{ padding: 20 }}>
        <p><b>Keep until {day(r.retention_until)}.</b> {st === "past" ? "The retention period is over: this record can be disposed of securely." : st === "ending" ? "The retention period ends soon." : ""}</p>
        {r.document_id && may("compliance.vault") && <p><a className="monarch-secondary" href={`/office/compliance/vault/download/${r.document_id}`}>Open the signed 8879</a></p>}
        <ActionForm action={update8879Action} className="monarch-form compliance-form">
          <input type="hidden" name="id" value={r.id} />
          <Fields8879 r={r} files={files} year={r.tax_year} />
          <div className="is-wide"><button className="monarch-primary">Save</button></div>
        </ActionForm>
      </section>
      <section className="monarch-panel" style={{ padding: 20 }}>
        <h2 style={{ marginTop: 0 }}>Delete this record</h2>
        <p className="monarch-muted">Deleting the tracking record doesn&apos;t delete the PDF in the vault; that&apos;s a separate step in the vault.</p>
        <ActionForm action={delete8879Action} className="compliance-stack">
          <input type="hidden" name="id" value={r.id} />
          {early.early && <p className="monarch-alert is-error">{early.warning}</p>}
          <label>{early.early ? "Reason (required, kept in the history)" : "Reason (optional)"}<textarea name="reason" rows={2} maxLength={1000} required={early.early} /></label>
          <button className="monarch-secondary is-danger">{early.early ? "Delete anyway" : "Delete record"}</button>
        </ActionForm>
      </section>
      <section className="monarch-panel">
        <div className="monarch-panel-head"><div><h2>History</h2></div></div>
        <ul className="fees-history">{events.length === 0 ? <li className="monarch-muted">Nothing yet.</li> : events.map((e) => <li key={e.id}><b>{e.action.replace(/_/g, " ")}</b> · {e.actor_name ?? ""} · {stamp(e.created_at)}{e.reason ? ` · Reason: ${e.reason}` : ""}</li>)}</ul>
      </section>
    </>
  );
}
