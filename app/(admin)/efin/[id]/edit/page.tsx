import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { Badge, Flash, label, load, SetupRequired } from "@/components/admin/ui";
import { Icon } from "@/components/admin/icons";
import { loadSnapshot } from "@/lib/efin/service";
import { EFIN_STATUSES } from "@/lib/efin/types.ts";
import { setFirmOptionsAction, updateEfinAction } from "../../actions";
import { ActionForm } from "../../action-form";
import { AddEfinForm } from "../../add-efin-form";
import { EroAdmin } from "../../ero-admin";
import { FormattedInput } from "../../formatted-input";
import { Select, VERIFY_OPTIONS } from "../../parts";

/** Everything that changes a firm lives here, so the firm page itself stays a calm summary. */
export default async function EditFirm({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ open?: string; notice?: string; error?: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  const result = await load(loadSnapshot);
  if (!result.ok) return <SetupRequired message={result.message} module="efin" />;
  const s = result.data;
  const efin = s.efins.find((e) => e.id === id);
  if (!efin) notFound();
  const org = s.orgs.find((o) => o.id === efin.organization_id);
  if (!org) notFound();
  const here = `/efin/${id}/edit`;
  return (
    <>
      <nav className="efin-crumbs" aria-label="Breadcrumb">
        <Link href="/efin" aria-label="My Service Bureau"><Icon name="home" size={16} /></Link>
        <Link href="/efin">My Service Bureau</Link><span>›</span>
        <Link href="/efin/list">Firms</Link><span>›</span>
        <Link href={`/efin/${id}`}>{org.legal_name}</Link><span>›</span>
        <b>Edit</b>
      </nav>
      <h1 className="efin-edit-title">Edit {org.legal_name}</h1>
      <p className="monarch-muted" style={{ marginTop: 0 }}>Changes are recorded in the activity history. <Link href={`/efin/${id}`} className="efin-card-link">Back to the firm</Link></p>
      <Flash notice={sp.notice} error={sp.error} />
      <div className="efin-flow">
        <details className="efin-edit" open={sp.open === "software"}>
          <summary>Software &amp; banking</summary>
          <div className="efin-edit-body">
            {s.options.filter((o) => o.active).length === 0 ? (
              <p className="monarch-muted" style={{ margin: 0 }}>Your lists are empty. <Link className="efin-card-link" href="/bureau/settings">Add your tax software and bank products in Settings</Link> first.</p>
            ) : (
              <ActionForm action={setFirmOptionsAction} className="efin-optform">
                <input type="hidden" name="organization_id" value={org.id} /><input type="hidden" name="back" value={here} />
                {(["tax_software", "bank_product"] as const).map((kind) => (
                  <div key={kind}>
                    <h3>{kind === "tax_software" ? "Tax software" : "Bank products"}</h3>
                    <div className="efin-checks">
                      {s.options.filter((o) => o.kind === kind && (o.active || s.orgOptions.some((x) => x.organization_id === org.id && x.option_id === o.id))).map((o) => (
                        <label key={o.id} className="monarch-check"><input type="checkbox" name="option_ids" value={o.id} defaultChecked={s.orgOptions.some((x) => x.organization_id === org.id && x.option_id === o.id)} /> {o.name}{!o.active && <small className="monarch-muted"> (hidden in Settings)</small>}</label>
                      ))}
                    </div>
                  </div>
                ))}
                <div><button className="monarch-primary" type="submit">Save</button></div>
              </ActionForm>
            )}
          </div>
        </details>
        {org && (
          <section className="monarch-panel">
            <div className="monarch-panel-head"><div><h2>EFINs for {org.legal_name}</h2><p>Every EFIN recorded for this ERO.</p></div></div>
            <ul className="efin-eflist">
              {s.efins.filter((e) => e.organization_id === org.id).map((e) => (
                <li key={e.id}>{e.id === id ? <b className="efin-mask">••{e.efin_last4}</b> : <Link href={`/efin/${e.id}`} className="efin-mask">••{e.efin_last4}</Link>}<Badge value={e.internal_status === "pending_verification" ? "pending" : e.internal_status} /><span className="monarch-muted">{e.recorded_expiration ? `renews ${e.recorded_expiration}` : "no renewal date"}{e.archived_at ? " · archived" : ""}</span></li>
              ))}
            </ul>
          </section>
        )}
        {org && !org.archived_at && (
          <details className="efin-edit" open={sp.open === "efin"}>
            <summary>Add another EFIN</summary>
            <div className="efin-edit-body"><AddEfinForm s={s} org={org} back={here} /></div>
          </details>
        )}
        {!efin.archived_at && (
          <details className="efin-edit" open={sp.open === "efin"}>
            <summary>Update this EFIN</summary>
            <div className="efin-edit-body">
            <ActionForm action={updateEfinAction} className="monarch-form">
              <input type="hidden" name="id" value={id} /><input type="hidden" name="back" value={here} />
              <label>Correct the EFIN number <small className="monarch-muted">(leave empty to keep ••{efin.efin_last4})</small><FormattedInput kind="efin" name="efin"  /></label>
              <label>Filing office for this EFIN<Select name="location_id" value={efin.location_id} empty="Not set" options={s.locations.filter((l) => l.organization_id === efin.organization_id && !l.archived_at).map((l) => ({ value: l.id, label: l.name }))} /></label>
              <label>Internal status<Select name="internal_status" value={efin.internal_status} options={EFIN_STATUSES.map((v) => ({ value: v, label: label(v) }))} /></label>
              <label>Status<Select name="external_status" value={efin.external_status} options={VERIFY_OPTIONS} /></label>
              <label>How it was confirmed<input name="verification_source" defaultValue={efin.verification_source ?? ""} maxLength={300} /></label>
              <label>Next review date<input type="date" name="recorded_expiration" defaultValue={efin.recorded_expiration ?? ""} /></label>
              <label className="monarch-check is-wide"><input type="checkbox" name="expiration_verified" defaultChecked={efin.expiration_verified} /> This date is confirmed. The original deadline is kept in the history when a date changes.</label>
              <label className="is-wide">Reason for a status change (required when the status changes)<input name="reason" maxLength={1000} /></label>
              <label className="is-wide">Notes<textarea name="notes" rows={3} maxLength={4000} defaultValue={efin.notes ?? ""} /></label>
              <label className="monarch-check is-wide"><input type="checkbox" name="confirm" /> I confirm moving this EFIN to suspended or inactive (high-impact).</label>
              <div className="is-wide"><button className="monarch-primary" type="submit">Save changes</button></div>
            </ActionForm>
            </div>
          </details>
        )}
        {org && <EroAdmin s={s} org={org} efin={efin} back={here} openSection={sp.open} />}
      </div>
    </>
  );
}
