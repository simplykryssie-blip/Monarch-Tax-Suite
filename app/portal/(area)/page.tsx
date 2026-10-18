import { requirePortal } from "@/lib/portal/server";
import { boardStagesFor } from "@/lib/portal/stages";
import { RETURN_KINDS } from "@/lib/workspace/types";

export default async function PortalHome() {
  const ctx = await requirePortal();
  const [client, returns, stages] = await Promise.all([ctx.reader.client(), ctx.reader.returns(), boardStagesFor(ctx.tenantId)]);
  const stageName = (id: string) => stages.find((s) => s.id === id)?.name ?? "In progress";
  return (
    <>
      <h1 className="office-h1">Hello{client ? `, ${client.full_name.split(" ")[0]}` : ""}</h1>
      <section className="monarch-panel" style={{ padding: 20 }}>
        <h2 style={{ marginTop: 0 }}>Your returns</h2>
        {returns.length === 0 ? (
          <p className="monarch-muted">{ctx.office.name} hasn&apos;t started a return for you yet. It will show up here when they do.</p>
        ) : (
          <div className="monarch-table-wrap">
            <table className="monarch-table">
              <thead><tr><th>Return</th><th>Status</th><th>Due</th><th>Filed</th></tr></thead>
              <tbody>
                {returns.map((r) => (
                  <tr key={r.id}><td><b>{r.tax_year}</b> {RETURN_KINDS[r.kind]}</td><td>{stageName(r.stage_id)}</td><td>{r.due_on ?? "—"}</td><td>{r.filed_on ?? "—"}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
