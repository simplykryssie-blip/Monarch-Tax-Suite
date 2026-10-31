import { requireAdmin } from "@/lib/admin";
import { notFound } from "next/navigation";
import { Flash, PageTitle } from "@/components/admin/ui";
import { balance, dollars } from "@/lib/workspace/rules.ts";
import { workspaceLoad, workspaceRepo } from "@/lib/workspace/load";
import { reviewImportAction } from "../../../actions";
import { WorkspaceSetup } from "../../../setup";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MATCH = { exact: ["Exact match", "match-exact"], possible: ["Possible: confirm", "match-possible"], manual: ["Set by you", "match-exact"], none: ["No match", "match-none"] } as const;

/** Review a bank import: every deposit, what was read from it, the invoice it matched, all editable before anything is applied. */
export default async function ReviewImportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  // The layout and this page render side by side, so the page proves the workspace itself before reading anything.
  await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  if (!UUID.test(id)) notFound();
  const result = await workspaceLoad(async () => {
    const repo = workspaceRepo();
    const imp = await repo.getImport(id);
    if (!imp) return null;
    const [rows, invoices, clients] = await Promise.all([repo.listImportRows(id), repo.listInvoices(), repo.listClients({ includeArchived: true })]);
    return { imp, rows, invoices, clients };
  });
  if (result.ok && !result.data) notFound();
  if (!result.ok) return <><PageTitle title="Review import" back={{ href: "/workspace/billing/import", label: "Import" }} /><WorkspaceSetup message={result.message} /></>;
  const { imp, rows, invoices, clients } = result.data!;
  const names = new Map(clients.map((c) => [c.id, c.full_name]));
  const open = invoices.filter((i) => i.status !== "void" && (balance(i) > 0 || rows.some((r) => r.invoice_id === i.id)));
  const editable = imp.status === "review";
  const label = (i: (typeof invoices)[number]) => `${i.number} · ${names.get(i.client_id) ?? "?"} · ${i.tax_year} · ${dollars(balance(i))} due`;
  return (
    <>
      <PageTitle title={imp.file_name} back={{ href: "/workspace/billing/import", label: "Import" }}>
        {imp.status === "review" ? "Check each match. Tick the payments to apply; change the invoice or amount if a match is wrong; ignore anything that isn't a client payment." : imp.status === "applied" ? "This import was applied." : "This import was discarded."}
      </PageTitle>
      <Flash notice={sp.notice} error={sp.error} />
      <form action={reviewImportAction}>
        <input type="hidden" name="id" value={imp.id} />
        <section className="monarch-panel">
          <div className="monarch-table-wrap"><table>
            <thead><tr><th>APPLY</th><th>DATE</th><th>DEPOSIT</th><th>READ AS</th><th>MATCH</th><th>INVOICE</th><th>AMOUNT</th><th>IGNORE</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const done = r.status === "applied";
                return (
                  <tr key={r.id} style={done ? { opacity: 0.6 } : undefined}>
                    <td><input type="hidden" name="row" value={r.id} />{editable && !done && r.status === "pending" ? <input type="checkbox" name="apply" value={r.id} defaultChecked={r.match === "exact"} aria-label={`Apply row ${r.row_no}`} /> : <span>{r.status === "applied" ? "Applied" : r.status === "ignored" ? "Ignored: untick to restore" : ""}</span>}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{r.posted_on ?? "—"}</td>
                    <td style={{ whiteSpace: "normal", maxWidth: 280 }}>{r.description || "—"}</td>
                    <td style={{ whiteSpace: "normal" }}>{r.name_guess ?? "—"}<small className="monarch-subcell">{r.tax_year ?? "no year"} · {r.ssn_last4 ? `SSN ••${r.ssn_last4}` : "no SSN digits"}</small></td>
                    <td className={MATCH[r.match][1]}>{MATCH[r.match][0]}</td>
                    <td>
                      <select name={`invoice_${r.id}`} defaultValue={r.invoice_id ?? ""} disabled={!editable || done} aria-label={`Invoice for row ${r.row_no}`}>
                        <option value="">No invoice</option>
                        {open.map((i) => <option key={i.id} value={i.id}>{label(i)}</option>)}
                      </select>
                    </td>
                    <td><input name={`amount_${r.id}`} size={9} defaultValue={(r.amount_cents / 100).toFixed(2)} disabled={!editable || done} aria-label={`Amount for row ${r.row_no}`} /></td>
                    <td><input type="checkbox" name={`ignore_${r.id}`} defaultChecked={r.status === "ignored"} disabled={!editable || done} aria-label={`Ignore row ${r.row_no}`} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        </section>
        {editable && (
          <section className="monarch-panel" style={{ padding: 20, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button name="do" value="apply" className="monarch-primary">Apply ticked payments</button>
            <button name="do" value="save" className="monarch-secondary">Save my changes</button>
            <button name="do" value="discard" className="monarch-secondary is-danger" formNoValidate>Discard this import</button>
            <p className="monarch-muted" style={{ margin: 0 }}>Applying records each payment on its invoice and marks it paid when the balance is covered. A row is applied only once.</p>
          </section>
        )}
      </form>
    </>
  );
}
