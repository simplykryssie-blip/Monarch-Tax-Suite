import { EmptyRow } from "@/components/admin/ui";
import { ComplianceTabs, compliancePage, loadOr, SetupNotice, stamp } from "../parts";

const WHAT: Record<string, string> = { attestation: "WISP attestation", ack: "Acknowledgment", "8879": "Form 8879", document: "Vault", ptin: "PTIN", incident: "Incident", item: "Checklist", settings: "Settings" };

/** Everything that happened in the Compliance Center, including every early deletion and its reason. Kept for good. */
export default async function History() {
  const { ctx, deps, may } = await compliancePage("compliance.manage");
  const result = await loadOr(() => deps.repo.listEvents(ctx.officeId, { limit: 300 }));
  return (
    <>
      <h1 className="office-h1">Compliance history</h1>
      <ComplianceTabs may={may} active="/office/compliance/history" />
      {!result.ok ? <SetupNotice message={result.message} /> : (
        <section className="monarch-panel">
          <div className="monarch-panel-head"><div><h2>Latest 300 entries</h2><p>The history can&apos;t be changed or deleted.</p></div></div>
          <div className="monarch-table-wrap"><table>
            <thead><tr><th>WHEN</th><th>AREA</th><th>WHAT</th><th>WHO</th><th>REASON</th></tr></thead>
            <tbody>{result.data.length === 0 ? <EmptyRow colSpan={5}>Nothing yet.</EmptyRow> : result.data.map((e) => (
              <tr key={e.id} className={e.action.includes("early") || e.action.includes("open_items") ? "compliance-override" : undefined}>
                <td>{stamp(e.created_at)}</td>
                <td>{WHAT[e.entity] ?? e.entity}</td>
                <td>{e.action.replace(/_/g, " ")}{typeof e.detail.title === "string" ? `: ${e.detail.title}` : typeof e.detail.return_ref === "string" ? `: ${e.detail.return_ref}` : ""}</td>
                <td>{e.actor_name ?? "—"}</td>
                <td>{e.reason ?? ""}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </section>
      )}
    </>
  );
}
