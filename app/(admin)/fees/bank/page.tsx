import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { EmptyRow, Flash, load, PageTitle, SetupRequired, when } from "@/components/admin/ui";
import { ActionForm } from "../../efin/action-form";
import { FeesImport } from "@/components/admin/fees-import";
import { BANK_FIELDS } from "@/lib/fees/csv.ts";
import { dollars } from "@/lib/fees/engine.ts";
import { feesDeps } from "@/lib/fees/server";
import { linkReceiptAction } from "../actions";
import { FeesNav } from "../parts";

export default async function BankImportsPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const deps = feesDeps();
  const result = await load(async () => {
    const [banks, imports, unmatched, offices] = await Promise.all([deps.repo.listBanks(), deps.repo.listImports(), deps.repo.listReceipts({ unmatched: true }), deps.repo.listOffices()]);
    return { banks, imports, unmatched, offices: offices.filter((o) => !o.archived) };
  });
  return (
    <>
      <PageTitle title="Bank imports" back={{ href: "/fees", label: "Fees & Statements" }}>Upload a bank&apos;s CSV of fees owed and collected on bank-product returns. Each row is matched to a return by its reference; rows that don&apos;t match are kept below for you to link. The same file can&apos;t be imported twice, and imported amounts can&apos;t be edited.</PageTitle>
      <Flash notice={sp.notice} error={sp.error} />
      <FeesNav active="bank" />
      {!result.ok ? <SetupRequired message={result.message} /> : (() => {
        const { banks, imports, unmatched, offices } = result.data;
        const bankName = (id: string | null) => banks.find((b) => b.id === id)?.name ?? "Bank";
        return (
          <div className="efin-flow">
            <section className="monarch-panel" style={{ padding: 20 }}>
              {banks.length === 0
                ? <div className="monarch-notice"><b>NO BANKS YET</b> Add your bank products in <Link href="/bureau/settings">Software &amp; banking</Link> first.</div>
                : <FeesImport kind="bank" fields={BANK_FIELDS} banks={banks.filter((b) => b.active)} />}
            </section>

            <section className="monarch-panel">
              <div className="monarch-panel-head"><div><h2>Rows to link · {unmatched.length}</h2><p>These bank rows matched no return, or more than one. Pick the office and the return reference to link each one.</p></div></div>
              <div className="monarch-table-wrap"><table>
                <thead><tr><th>BANK</th><th>REFERENCE IN FILE</th><th>TAXPAYER</th><th>OWED</th><th>COLLECTED</th><th>LINK TO</th></tr></thead>
                <tbody>
                  {unmatched.length === 0 ? <EmptyRow colSpan={6}>Every bank row is linked to a return.</EmptyRow> : unmatched.map((x) => (
                    <tr key={x.id}>
                      <td>{bankName(x.bank_option_id)}<div className="monarch-muted">{x.received_on ?? ""}</div></td>
                      <td><b>{x.row_ref ?? "—"}</b></td>
                      <td>{x.row_name ?? "—"}</td>
                      <td>{x.owed_cents === null ? "—" : dollars(x.owed_cents)}</td>
                      <td>{dollars(x.collected_cents)}</td>
                      <td>
                        <ActionForm action={linkReceiptAction} className="efin-actions">
                          <input type="hidden" name="id" value={x.id} />
                          <select name="office_id" required defaultValue="" aria-label="Office"><option value="">Office…</option>{offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
                          <input name="return_ref" required defaultValue={x.row_ref ?? ""} maxLength={80} aria-label="Return reference" className="fees-amount" />
                          <input name="tax_year" placeholder="Year" inputMode="numeric" aria-label="Tax year (optional)" className="fees-order" />
                          <button className="monarch-secondary efin-small">Link</button>
                        </ActionForm>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </section>

            <section className="monarch-panel">
              <div className="monarch-panel-head"><div><h2>Imported files</h2></div></div>
              <div className="monarch-table-wrap"><table>
                <thead><tr><th>FILE</th><th>BANK</th><th>ROWS</th><th>MATCHED</th><th>TO LINK</th><th>IMPORTED</th></tr></thead>
                <tbody>
                  {imports.length === 0 ? <EmptyRow colSpan={6}>No bank files imported yet.</EmptyRow> : imports.map((i) => (
                    <tr key={i.id}><td><b>{i.file_name}</b></td><td>{bankName(i.bank_option_id)}</td><td>{i.row_count}</td><td>{i.matched_count}</td><td>{i.unmatched_count}</td><td>{when(i.created_at)}</td></tr>
                  ))}
                </tbody>
              </table></div>
            </section>
          </div>
        );
      })()}
    </>
  );
}
