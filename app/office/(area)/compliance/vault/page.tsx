import { EmptyRow, Flash } from "@/components/admin/ui";
import { ActionForm } from "@/app/(admin)/efin/action-form";
import { VaultUpload } from "@/components/office/vault-upload";
import { earlyDeletion, retentionState, settingsOf, todayIso } from "@/lib/compliance/rules.ts";
import { DOC_KINDS, type DocKind } from "@/lib/compliance/types.ts";
import { deleteDocumentAction } from "../actions";
import { ComplianceTabs, compliancePage, day, loadOr, SetupNotice, stamp } from "../parts";

/** The office's private document vault: 8879s, WISPs, training records and signed acknowledgments. */
export default async function VaultPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string; kind?: string; q?: string }> }) {
  const { ctx, deps, may } = await compliancePage("compliance.vault");
  const sp = await searchParams;
  const kind = sp.kind && sp.kind in DOC_KINDS ? (sp.kind as DocKind) : undefined;
  const q = (sp.q ?? "").slice(0, 100);
  const result = await loadOr(async () => ({ docs: await deps.repo.listDocuments(ctx.officeId, { kind, q }), settings: settingsOf(await deps.repo.getSettings(ctx.officeId)) }));
  const today = todayIso();
  const query = new URLSearchParams({ ...(kind ? { kind } : {}), ...(q ? { q } : {}) }).toString();
  return (
    <>
      <h1 className="office-h1">Document vault</h1>
      <ComplianceTabs may={may} active="/office/compliance/vault" />
      <Flash notice={sp.notice} error={sp.error} />
      {!result.ok ? <SetupNotice message={result.message} /> : (
        <>
          <section className="monarch-panel" style={{ padding: 20 }}>
            <h2 style={{ marginTop: 0 }}>Add a document</h2>
            <p className="monarch-muted">Files are private to your office and opened only through one-minute links. Your service bureau can&apos;t open them.</p>
            <VaultUpload />
          </section>
          <section className="monarch-panel">
            <div className="monarch-panel-head">
              <div><h2>Documents</h2><p>{result.data.docs.length} {result.data.docs.length === 1 ? "file" : "files"}</p></div>
              <a className="monarch-secondary" href={`/office/compliance/vault/export${query ? `?${query}` : ""}`}>Export list (CSV)</a>
            </div>
            <form method="get" className="monarch-inline-form" style={{ padding: "0 20px 16px", flexWrap: "wrap" }}>
              <input name="q" type="search" placeholder="Search titles" defaultValue={q} aria-label="Search" maxLength={100} />
              <select name="kind" defaultValue={kind ?? ""} aria-label="Kind"><option value="">Every kind</option>{Object.entries(DOC_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <button className="monarch-secondary">Filter</button>
            </form>
            <div className="monarch-table-wrap"><table>
              <thead><tr><th>DOCUMENT</th><th>KIND</th><th>KEEP UNTIL</th><th>ADDED</th><th></th></tr></thead>
              <tbody>
                {result.data.docs.length === 0 ? <EmptyRow colSpan={5}>{q || kind ? "Nothing matches." : "The vault is empty."}</EmptyRow> : result.data.docs.map((d) => {
                  const early = earlyDeletion(d.retention_until, today);
                  const st = d.retention_until ? retentionState(d.retention_until, today, result.data.settings.retention_alert_days) : null;
                  return (
                    <tr key={d.id}>
                      <td><a href={`/office/compliance/vault/download/${d.id}`}><b>{d.title}</b></a><small className="monarch-subcell">{d.file_type.toUpperCase()}{d.size_bytes ? ` · ${Math.max(1, Math.round(d.size_bytes / 1024))} KB` : ""}</small></td>
                      <td>{DOC_KINDS[d.kind]}</td>
                      <td>{d.retention_until ? <>{day(d.retention_until)}{st === "past" && <small className="monarch-subcell">Past retention: can be disposed of</small>}{st === "ending" && <small className="monarch-subcell">Retention ending soon</small>}</> : "—"}</td>
                      <td>{stamp(d.created_at)}<small className="monarch-subcell">{d.uploaded_by_name ?? ""}</small></td>
                      <td>
                        <details className="compliance-delete">
                          <summary>Delete</summary>
                          <ActionForm action={deleteDocumentAction} className="compliance-stack">
                            <input type="hidden" name="id" value={d.id} />
                            {early.early && <p className="monarch-alert is-error">{early.warning}</p>}
                            <label>{early.early ? "Reason (required, kept in the history)" : "Reason (optional)"}<textarea name="reason" rows={2} maxLength={1000} required={early.early} /></label>
                            <button className="monarch-secondary is-danger efin-small">{early.early ? "Delete anyway" : "Delete file"}</button>
                          </ActionForm>
                        </details>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          </section>
        </>
      )}
    </>
  );
}
