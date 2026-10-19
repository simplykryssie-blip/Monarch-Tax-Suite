import { requireAdmin } from "@/lib/admin";
import { EmptyRow, Flash, load, PageTitle, SetupRequired, when } from "@/components/admin/ui";
import { feesDeps } from "@/lib/fees/server";
import { FeesNav } from "../parts";

const ACTION: Record<string, string> = {
  template_loaded: "Loaded Monarch's template", line_added: "Added a fee line", line_changed: "Changed a fee line", line_removed: "Removed a fee line",
  override_set: "Set an office's amount", override_removed: "Back to the bureau amount", return_recorded: "Recorded a return", return_changed: "Changed a return",
  fees_reapplied: "Re-applied fees", return_archived: "Archived a return", return_restored: "Restored a return", marked_paid: "Marked paid by ERO",
  returns_imported: "Imported returns", bank_imported: "Imported a bank file", bank_row_linked: "Linked a bank row", statement_csv: "Exported a CSV statement", statement_pdf: "Exported a PDF statement",
};

/** Every fee change, newest first. The history can't be edited or deleted. */
export default async function FeeHistoryPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const deps = feesDeps();
  const result = await load(async () => ({ events: await deps.repo.listEvents({ limit: 300 }), offices: await deps.repo.listOffices() }));
  return (
    <>
      <PageTitle title="Fee history" back={{ href: "/fees", label: "Fees & Statements" }}>Every change to fees, returns, imports and payments: who, when and what. It can&apos;t be edited or deleted.</PageTitle>
      <Flash notice={sp.notice} error={sp.error} />
      <FeesNav active="history" />
      {!result.ok ? <SetupRequired message={result.message} /> : (
        <section className="monarch-panel">
          <div className="monarch-table-wrap"><table>
            <thead><tr><th>WHEN</th><th>WHAT</th><th>OFFICE</th><th>DETAIL</th></tr></thead>
            <tbody>
              {result.data.events.length === 0 ? <EmptyRow colSpan={4}>Nothing yet.</EmptyRow> : result.data.events.map((e) => (
                <tr key={e.id}>
                  <td>{when(e.created_at)}</td>
                  <td><b>{ACTION[e.action] ?? e.action.replace(/_/g, " ")}</b>{e.reason && <div className="monarch-muted">{e.reason}</div>}</td>
                  <td>{e.organization_id ? result.data.offices.find((o) => o.id === e.organization_id)?.name ?? "—" : "Bureau"}</td>
                  <td className="monarch-muted">{Object.entries(e.detail).map(([k, v]) => `${k.replace(/_/g, " ")}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" · ").slice(0, 300)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </section>
      )}
    </>
  );
}
