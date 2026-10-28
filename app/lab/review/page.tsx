import Link from "next/link";
import { redirect } from "next/navigation";
import { labRepo, requireLab } from "@/lib/lab/server";
import { reviewQueue } from "@/lib/lab/service";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review queue" };

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");

export default async function ReviewQueuePage() {
  const ctx = await requireLab("/lab/review");
  const ms = ctx.membership;
  if (ms?.member.role !== "instructor") redirect("/lab");
  const repo = labRepo();
  const queue = await reviewQueue(repo, ms);
  const titles = new Map<string, string>();
  for (const q of queue) if (!titles.has(q.work.scenario_id)) titles.set(q.work.scenario_id, (await repo.getScenario(q.work.scenario_id))?.title ?? "Deleted scenario");
  return (
    <div className="lab-wrap"><main className="lab-main lab-stack">
      <div className="lab-stack" style={{ gap: 6 }}>
        <span className="lab-eyebrow">Your class</span>
        <h1>Review queue</h1>
        <p className="lab-muted">Returns your students submitted, newest first. Ungraded returns are at the top.</p>
      </div>
      {queue.length === 0 ? <div className="lab-card lab-empty"><h2>Nothing to review yet</h2><p className="lab-muted">Submitted returns appear here.</p></div> : (
        <div className="lab-card lab-scroll"><table className="lab-table">
          <thead><tr><th>Student</th><th>Scenario</th><th>Lines</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {queue.map(({ work, student }) => (
              <tr key={work.id}>
                <td><b>{student.display_name || student.email}</b><br /><span className="lab-muted lab-small">{when(work.submitted_at)}</span></td>
                <td>{titles.get(work.scenario_id)}</td>
                <td className="v">{work.correct}/{work.total}</td>
                <td>{work.status === "graded" ? (work.grade === "revise" ? <span className="lab-pill warn">Revise</span> : <span className="lab-pill good">Passed</span>) : <span className="lab-pill">New</span>}</td>
                <td><Link className="lab-btn sm" href={`/lab/review/${work.id}`}>Open</Link></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </main></div>
  );
}
