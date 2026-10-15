import Link from "next/link";
import { EmptyRow, Flash, load, PageTitle, when } from "@/components/admin/ui";
import { pipelinesRepo } from "@/lib/pipelines/server";
import { DEFAULT_RETURN_STAGES } from "@/lib/pipelines/service.ts";
import { createPipelineAction } from "../actions";
import { SubmitOnce } from "@/components/admin/submit-once";

export default async function PipelinesPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const { notice, error } = await searchParams;
  const result = await load(() => pipelinesRepo().list());
  const list = result.ok ? result.data.filter((p) => !p.archived_at) : [];
  const hasReturns = list.some((p) => p.kind === "returns");
  return (
    <>
      <PageTitle title="Pipelines">The stages a piece of work moves through, as a row you can build and rearrange. The default tax-return pipeline runs the My Work board.</PageTitle>
      <Flash notice={notice} error={error} />
      {!result.ok ? (
        <div className="monarch-notice"><b>DATABASE SETUP REQUIRED</b> Pipelines needs its table. Apply <code>supabase/migrations/20261026090000_pipelines_sms.sql</code>, then reload. <small>({result.message})</small></div>
      ) : (
        <>
          {!hasReturns && (
            <section className="monarch-panel" style={{ padding: 20 }}>
              <h2>Start with the standard tax-return pipeline</h2>
              <p className="monarch-muted">{DEFAULT_RETURN_STAGES.map((s) => s.name).join(" → ")}. You can rename, add, remove and reorder every stage afterwards. Until you create one, My Work uses these stages.</p>
              <form action={createPipelineAction}><input type="hidden" name="name" value="Tax returns" /><input type="hidden" name="kind" value="returns" /><input type="hidden" name="quick" value="1" /><SubmitOnce className="monarch-primary" busy="Creating…">Create the tax-return pipeline</SubmitOnce></form>
            </section>
          )}
          <section className="monarch-panel">
            <div className="monarch-panel-head"><div><h2>Your pipelines</h2></div></div>
            <div className="monarch-table-wrap"><table>
              <thead><tr><th>NAME</th><th>FOR</th><th>STAGES</th><th>UPDATED</th></tr></thead>
              <tbody>
                {list.length === 0 ? <EmptyRow colSpan={4}>No pipelines yet.</EmptyRow> : list.map((p) => (
                  <tr key={p.id}>
                    <td><Link href={`/automation/pipelines/${p.id}`}><b>{p.name}</b></Link>{p.is_default && <span className="efin-tag">Runs My Work</span>}</td>
                    <td>{p.kind === "returns" ? "Tax returns" : "Other work"}</td>
                    <td><span className="pb-flow">{p.stages.map((s) => <span key={s.id}><i style={{ background: s.color }} />{s.name} </span>)}</span></td>
                    <td>{when(p.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </section>
          <section className="monarch-panel" style={{ padding: 20 }}>
            <h2>New pipeline</h2>
            <form action={createPipelineAction} className="monarch-inline-form" style={{ flexWrap: "wrap" }}>
              <input name="name" required maxLength={80} placeholder="e.g. Amended returns" aria-label="Pipeline name" />
              <select name="kind" defaultValue="custom" aria-label="What it is for"><option value="custom">Other work</option><option value="returns">Tax returns</option></select>
              <SubmitOnce className="monarch-primary" busy="Creating…">Create and edit</SubmitOnce>
            </form>
          </section>
        </>
      )}
    </>
  );
}
