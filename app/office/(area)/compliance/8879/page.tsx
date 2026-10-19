import Link from "next/link";
import { EmptyRow, Flash } from "@/components/admin/ui";
import { ActionForm } from "@/app/(admin)/efin/action-form";
import { VaultUpload } from "@/components/office/vault-upload";
import { retentionState, settingsOf, todayIso } from "@/lib/compliance/rules.ts";
import { LOCATIONS } from "@/lib/compliance/types.ts";
import { create8879Action } from "../actions";
import { ComplianceTabs, compliancePage, day, loadOr, Required, SetupNotice } from "../parts";
import { Fields8879 } from "./fields";

const VIEWS = { all: "All", keep: "In retention", ending: "Ending soon", past: "Past retention" } as const;

/** Form 8879 per return: when the signed form went on file, where it's kept, and how long it must be kept. */
export default async function Page8879({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string; q?: string; view?: string; year?: string; uploaded?: string }> }) {
  const { ctx, deps, may } = await compliancePage("compliance.8879");
  const sp = await searchParams;
  const view = (sp.view && sp.view in VIEWS ? sp.view : "all") as keyof typeof VIEWS;
  const q = (sp.q ?? "").slice(0, 100);
  const year = Number(sp.year) >= 2000 && Number(sp.year) <= 2100 ? Number(sp.year) : undefined;
  const result = await loadOr(async () => {
    const [records, files, settings] = await Promise.all([deps.repo.list8879(ctx.officeId, { q, taxYear: year }), may("compliance.vault") ? deps.repo.listDocuments(ctx.officeId, { kind: "8879" }) : [], deps.repo.getSettings(ctx.officeId)]);
    return { records, files, settings: settingsOf(settings) };
  });
  const today = todayIso();
  const thisYear = Number(today.slice(0, 4)) - 1;
  if (!result.ok) return <><h1 className="office-h1">Form 8879</h1><SetupNotice message={result.message} /></>;
  const { records, files, settings } = result.data;
  const rows = records.map((r) => ({ r, st: retentionState(r.retention_until, today, settings.retention_alert_days) })).filter((x) => view === "all" || x.st === view);
  const query = new URLSearchParams({ ...(q ? { q } : {}), ...(year ? { year: String(year) } : {}), ...(view !== "all" ? { view } : {}) }).toString();
  return (
    <>
      <h1 className="office-h1">Form 8879 records</h1>
      <ComplianceTabs may={may} active="/office/compliance/8879" />
      <Flash notice={sp.notice} error={sp.error} />
      <p className="compliance-lede"><Required by="IRS" /> Keep each signed Form 8879 for 3 years from the return&apos;s due date or the date the IRS received it, whichever is later (Publication 1345). Records are flagged {settings.retention_alert_days} days before the end, and flagged for disposal after it. Nothing is deleted automatically.</p>
      <section className="monarch-panel">
        <div className="monarch-panel-head">
          <div><h2>Records</h2><p>{rows.length} shown</p></div>
          <a className="monarch-secondary" href={`/office/compliance/8879/export${query ? `?${query}` : ""}`}>Export CSV</a>
        </div>
        <form method="get" className="monarch-inline-form" style={{ padding: "0 20px 16px", flexWrap: "wrap" }}>
          <input name="q" type="search" placeholder="Return reference or taxpayer" defaultValue={q} aria-label="Search" maxLength={100} />
          <input name="year" inputMode="numeric" placeholder="Tax year" defaultValue={year ?? ""} aria-label="Tax year" style={{ width: 110 }} />
          <select name="view" defaultValue={view} aria-label="Retention">{Object.entries(VIEWS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <button className="monarch-secondary">Filter</button>
        </form>
        <div className="monarch-table-wrap"><table>
          <thead><tr><th>RETURN</th><th>TAX YEAR</th><th>ON FILE SINCE</th><th>KEPT IN</th><th>KEEP UNTIL</th></tr></thead>
          <tbody>
            {rows.length === 0 ? <EmptyRow colSpan={5}>{records.length ? "Nothing matches." : "No 8879 records yet. Add the first one below."}</EmptyRow> : rows.map(({ r, st }) => (
              <tr key={r.id}>
                <td><Link href={`/office/compliance/8879/${r.id}`}><b>{r.return_ref}</b></Link><small className="monarch-subcell">{r.taxpayer_name}</small></td>
                <td>{r.tax_year}</td>
                <td>{day(r.signed_on)}</td>
                <td>{LOCATIONS[r.location]}{r.document_id ? " · PDF" : ""}<small className="monarch-subcell">{r.location_note ?? ""}</small></td>
                <td>{day(r.retention_until)}{st !== "keep" && <small className={`monarch-subcell compliance-${st}`}>{st === "past" ? "Past retention: can be disposed of" : "Ending soon"}</small>}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </section>
      <section className="monarch-panel" style={{ padding: 20 }}>
        <h2 style={{ marginTop: 0 }}>Add a record</h2>
        {may("compliance.vault") && (
          <details className="compliance-inline-upload"><summary>Upload the signed 8879 PDF first (optional)</summary><VaultUpload kind="8879" label="Upload 8879" returnTo="/office/compliance/8879" /></details>
        )}
        <ActionForm action={create8879Action} className="monarch-form compliance-form">
          <Fields8879 files={sp.uploaded ? [...files.filter((f) => f.id === sp.uploaded), ...files.filter((f) => f.id !== sp.uploaded)] : files} year={thisYear} />
          <div className="is-wide"><button className="monarch-primary">Save record</button></div>
        </ActionForm>
      </section>
    </>
  );
}
