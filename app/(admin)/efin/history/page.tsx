import { requireAdmin } from "@/lib/admin";
import { EmptyRow, label, load, PageTitle, SetupRequired, when } from "@/components/admin/ui";
import { loadAudit } from "@/lib/efin/service";

export default async function History() {
  await requireAdmin();
  const result = await load(() => loadAudit({ limit: 200 }));
  return (
    <>
      <PageTitle title="History">An append-only record of changes and sensitive reads. It cannot be edited or deleted, by anyone, from the application or the database API.</PageTitle>
      {!result.ok ? <SetupRequired message={result.message} /> : (
        <section className="monarch-panel">
          <div className="monarch-table-wrap"><table>
            <thead><tr><th>WHEN</th><th>WHO</th><th>EVENT</th><th>TARGET</th><th>REASON</th></tr></thead>
            <tbody>{result.data.length === 0 ? <EmptyRow colSpan={5}>No activity recorded yet.</EmptyRow> : result.data.map((h) => (
              <tr key={h.id}><td>{when(h.occurred_at)}</td><td>{h.actor_email ?? "System"}</td><td><b>{label(h.event_type.replace(/\./g, " "))}</b></td><td>{h.target_type ?? "—"}</td><td style={{ whiteSpace: "normal" }}>{h.reason ?? "—"}</td></tr>
            ))}</tbody>
          </table></div>
        </section>
      )}
    </>
  );
}
