import Link from "next/link";
import { portalDocDeps, requirePortal } from "@/lib/portal/server";
import { boardStagesFor } from "@/lib/portal/stages";
import { RETURN_KINDS } from "@/lib/workspace/types";

const clock = () => Date.now();

export default async function PortalHome() {
  const ctx = await requirePortal();
  const [client, returns, stages] = await Promise.all([ctx.reader.client(), ctx.reader.returns(), boardStagesFor(ctx.tenantId)]);
  const open = await portalDocDeps(ctx.tenantId, ctx.clientId).repo.listRequests("open").catch(() => []);
  const toSign = (await ctx.reader.signatures().catch(() => [])).filter((s) => (s.status === "sent" || s.status === "viewed") && Date.parse(s.expiresAt) > clock());
  const stageName = (id: string) => stages.find((s) => s.id === id)?.name ?? "In progress";
  return (
    <>
      <h1 className="office-h1">Hello{client ? `, ${client.full_name.split(" ")[0]}` : ""}</h1>
      {toSign.length > 0 && (
        <section className="monarch-panel" style={{ padding: 20 }}>
          <h2 style={{ marginTop: 0 }}>Ready to sign</h2>
          <p>{toSign.map((s) => s.name).join(", ")}</p>
          <Link className="monarch-primary" href="/portal/sign">Review and sign</Link>
        </section>
      )}
      {open.length > 0 && (
        <section className="monarch-panel" style={{ padding: 20 }}>
          <h2 style={{ marginTop: 0 }}>Waiting on you</h2>
          <p>{ctx.office.name} is asking for {open.length === 1 ? "1 document" : `${open.length} documents`}: {open.map((r) => r.title).join(", ")}.</p>
          <Link className="monarch-primary" href="/portal/documents">Send {open.length === 1 ? "it" : "them"}</Link>
        </section>
      )}
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
