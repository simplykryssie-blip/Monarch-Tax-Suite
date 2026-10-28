import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Workspace } from "@/components/lab/workspace";
import { labRepo, requireLab } from "@/lib/lab/server";
import { canViewScenario, hasReviewer, studentView } from "@/lib/lab/service";

export const dynamic = "force-dynamic";
export const metadata = { title: "Practice return" };

/** A student's practice page for one scenario. The answer key is used on the server only and never sent here. */
export default async function PracticePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireLab(`/lab/s/${id}`);
  if (!ctx.membership) redirect("/lab?error=" + encodeURIComponent("Practicing needs a student or instructor license. Use Edit to preview a scenario."));
  const repo = labRepo();
  const scenario = await repo.getScenario(id);
  if (!scenario || scenario.status !== "published" || !canViewScenario(ctx, scenario)) notFound();
  const [key, work] = await Promise.all([repo.getKey(id), repo.getWork(ctx.membership.member.id, id)]);
  const view = studentView(scenario, key, false);
  return (
    <div className="lab-wrap wide"><main className="lab-main lab-stack">
      <Link className="lab-btn ghost" href="/lab">← All scenarios</Link>
      <div className="lab-stack" style={{ gap: 6 }}>
        <div className="lab-row"><span className="lab-pill">{scenario.level}</span>{scenario.intake_mode === "interview" ? <span className="lab-pill plain">Interview</span> : null}</div>
        <h1>{scenario.title}</h1>
      </div>
      <Workspace
        scenarioId={scenario.id}
        title={scenario.title}
        level={scenario.level}
        interview={scenario.intake_mode === "interview"}
        narrative={view.narrative}
        facts={view.facts}
        documents={scenario.documents ?? {}}
        checkCount={view.checkCount}
        initialRet={work?.ret ?? null}
        initialIntake={(work?.intake ?? {}) as Record<string, string | boolean>}
        canSubmit={hasReviewer(ctx.membership)}
        work={work ? { status: work.status, submittedAt: work.submitted_at, correct: work.correct, total: work.total, grade: work.grade, score: work.score, feedback: work.feedback, checksRun: work.checks_run } : null}
      />
    </main></div>
  );
}
