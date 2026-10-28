import Link from "next/link";
import { notFound } from "next/navigation";
import { ScenarioEditor } from "@/components/lab/scenario-editor";
import { blankReturn, DEFAULT_CHECKS } from "@/lib/lab/engine";
import { labRepo, requireLab } from "@/lib/lab/server";
import { canEditScenario } from "@/lib/lab/service";
import { deleteScenarioAction } from "../../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit scenario" };

export default async function EditScenarioPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<{ error?: string }> }) {
  const { id } = await params;
  const ctx = await requireLab(`/lab/scenarios/${id}`);
  const repo = labRepo();
  const s = await repo.getScenario(id);
  if (!s || !canEditScenario(ctx, s)) notFound();
  const key = await repo.getKey(id);
  const error = (await searchParams)?.error?.slice(0, 300);
  return (
    <div className="lab-wrap wide"><main className="lab-main lab-stack">
      <Link className="lab-btn ghost" href="/lab">← All scenarios</Link>
      <h1>{s.title}</h1>
      {error ? <div className="lab-notice bad">{error}</div> : null}
      <ScenarioEditor initial={{
        id: s.id, scope: s.license_id ? "license" : "library", status: s.status, title: s.title, level: s.level, summary: s.summary ?? "",
        narrative: s.narrative, factsText: s.facts.map((f) => `${f.label}: ${f.value}`).join("\n"), intakeMode: s.intake_mode, docOptions: s.doc_options,
        ret: key?.ret ?? blankReturn(), checks: key?.checks ?? [...DEFAULT_CHECKS],
        overrides: Object.fromEntries(Object.entries(key?.overrides ?? {}).map(([k, v]) => [k, String(v)])),
      }} />
      <div className="lab-card lab-stack">
        <h2>Print packets</h2>
        <p className="lab-muted lab-small">Packets show the last saved version.</p>
        <div className="lab-row">
          <a className="lab-btn" href={`/lab/s/${s.id}/packet`} target="_blank" rel="noopener">Student packet (PDF)</a>
          <a className="lab-btn" href={`/lab/s/${s.id}/packet?kind=instructor`} target="_blank" rel="noopener">Instructor packet with answer key</a>
        </div>
      </div>
      <div className="lab-card lab-stack">
        <h2>Delete this scenario</h2>
        <p className="lab-muted lab-small">Deleting removes the scenario, its answer key and every student’s work on it. This can’t be undone.</p>
        <form action={deleteScenarioAction} className="lab-row">
          <input type="hidden" name="id" value={s.id} />
          <label className="check"><input type="checkbox" name="confirm" value="yes" required /> I understand</label>
          <button type="submit" className="lab-btn danger">Delete scenario</button>
        </form>
      </div>
    </main></div>
  );
}
