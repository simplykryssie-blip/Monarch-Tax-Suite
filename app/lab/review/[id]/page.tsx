import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { compute, fmt, LINES, normalizeReturn, FILING_STATUSES } from "@/lib/lab/engine";
import { intakeRows } from "@/lib/lab/intake";
import { labRepo, requireLab } from "@/lib/lab/server";
import { reviewableWork } from "@/lib/lab/service";
import { gradeAction } from "../../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review a return" };

const FS = Object.fromEntries(FILING_STATUSES) as Record<string, string>;

export default async function ReviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<{ notice?: string; error?: string }> }) {
  const { id } = await params;
  const ctx = await requireLab(`/lab/review/${id}`);
  if (ctx.membership?.member.role !== "instructor") redirect("/lab");
  const repo = labRepo();
  const found = await reviewableWork(repo, ctx.membership, id).catch(() => null);
  if (!found) notFound();
  const { work, student } = found;
  const sp = await searchParams;
  const [scenario, key] = await Promise.all([repo.getScenario(work.scenario_id), repo.getKey(work.scenario_id)]);
  const ret = normalizeReturn(work.submitted_ret ?? work.ret);
  const c = compute(ret);
  const checked = new Set<string>(key?.checks ?? []);
  const intake = intakeRows(work.submitted_intake ?? work.intake);
  const entries: [string, string][] = [
    ["Filing status", FS[ret.fs]],
    ["Taxpayer", `${ret.tp.first} ${ret.tp.last}`.trim() || "—"],
    ...ret.deps.map((d) => ["Dependent", `${d.name || "—"} · ${d.rel}, age ${d.age || "?"}, ${d.months || "?"} months${d.ssn === false ? ", no SSN" : ""}`] as [string, string]),
    ...ret.w2.map((w) => ["W-2", `${w.employer || "—"} · wages ${fmt(w.wages)}, withheld ${fmt(w.fedwh)}`] as [string, string]),
    ...c.d.biz.map((b, i) => ["Schedule C", `${ret.schc[i].name || "—"} · receipts ${fmt(b.gross)}, expenses ${fmt(b.exp)}`] as [string, string]),
    ["Deduction", ret.ded.type === "item" ? `Itemized ${fmt(c.d.itemized)}` : "Standard"],
  ];
  return (
    <div className="lab-wrap"><main className="lab-main lab-stack">
      <Link className="lab-btn ghost" href="/lab/review">← Review queue</Link>
      <div className="lab-stack" style={{ gap: 6 }}>
        <span className="lab-eyebrow">{scenario?.title ?? "Deleted scenario"}</span>
        <h1>{student.display_name || student.email}</h1>
        <p className="lab-muted">Checked {work.checks_run} times · {work.correct} of {work.total} key lines matched · {work.efile_rejects ? `${work.efile_rejects} e-file rejects` : "no e-file rejects"}</p>
      </div>
      {sp?.notice ? <div className="lab-notice good">{sp.notice}</div> : null}
      {sp?.error ? <div className="lab-notice bad">{sp.error}</div> : null}
      {work.note ? <div className="lab-notice"><b>Student note</b><br /><span style={{ whiteSpace: "pre-line" }}>{work.note}</span></div> : null}

      <div className="lab-card lab-stack">
        <h2>Return vs. answer key</h2>
        <div className="lab-scroll"><table className="lab-table">
          <thead><tr><th>Line</th><th></th><th style={{ textAlign: "right" }}>Student</th><th style={{ textAlign: "right" }}>Key</th></tr></thead>
          <tbody>
            {LINES.map(([k, ln, label]) => {
              const sv = c.lines[k];
              const kv = key?.line_values[k];
              if (!checked.has(k) && !sv && !kv) return null;
              const match = kv !== undefined && Math.round(sv) === Math.round(kv);
              return (
                <tr key={k} style={checked.has(k) ? undefined : { opacity: 0.6 }}>
                  <td className="lab-num">{ln}</td>
                  <td>{label}{checked.has(k) ? null : <span className="lab-muted lab-small"> (not checked)</span>}</td>
                  <td className={`v ${kv === undefined ? "" : match ? "lab-ok" : "lab-no"}`}>{fmt(sv)}</td>
                  <td className="v">{kv === undefined ? "—" : fmt(kv)}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </div>

      <div className="lab-card lab-stack">
        <h2>Intake sheet</h2>
        {intake.length ? <dl className="lab-facts">{intake.map(([l, v], i) => <div key={i} style={{ display: "contents" }}><dt>{l}</dt><dd style={{ whiteSpace: "pre-line" }}>{v}</dd></div>)}</dl> : <p className="lab-muted">The student left the intake sheet blank.</p>}
      </div>

      <div className="lab-card lab-stack">
        <h2>Their entries</h2>
        <dl className="lab-facts">{entries.map(([l, v], i) => <div key={i} style={{ display: "contents" }}><dt>{l}</dt><dd>{v}</dd></div>)}</dl>
      </div>

      <form action={gradeAction} className="lab-card lab-stack">
        <h2>Grade</h2>
        <input type="hidden" name="work_id" value={work.id} />
        <div className="lab-grid2">
          <label className="f">Result<select name="grade" defaultValue={work.grade ?? "pass"}><option value="pass">Passed</option><option value="revise">Needs revision</option></select></label>
          <label className="f">Score <span className="hint">(optional)</span><input type="text" name="score" maxLength={20} defaultValue={work.score ?? ""} placeholder="90/100" /></label>
        </div>
        <label className="f">Feedback<textarea name="feedback" maxLength={4000} defaultValue={work.feedback ?? ""} placeholder="What they did well and what to fix" /></label>
        <div className="lab-row"><button type="submit" className="lab-btn primary">Save grade</button></div>
      </form>
    </main></div>
  );
}
