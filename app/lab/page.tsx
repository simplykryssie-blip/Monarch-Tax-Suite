import Link from "next/link";
import { labRepo, requireLab } from "@/lib/lab/server";
import { canEditScenario, hasReviewer, reviewQueue, seatsUsed, visibleScenarios } from "@/lib/lab/service";
import type { LabScenario } from "@/lib/lab/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Scenarios" };

const date = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

/** The lab home: the scenarios this person can practice (and edit), with their progress. */
export default async function LabHome({ searchParams }: { searchParams?: Promise<{ notice?: string; error?: string }> }) {
  const ctx = await requireLab("/lab");
  const sp = await searchParams;
  const repo = labRepo();
  const ms = ctx.membership;
  const scenarios = await visibleScenarios(repo, ctx);
  const work = ms ? await repo.workForMembers([ms.member.id]) : [];
  const workBy = new Map(work.map((w) => [w.scenario_id, w]));
  const instructor = ms?.member.role === "instructor";
  const members = instructor ? await repo.membersOfLicense(ms!.member.license_id) : [];
  const pending = instructor ? (await reviewQueue(repo, ms!)).filter((q) => q.work.status === "submitted").length : 0;

  const status = (s: LabScenario) => {
    const w = workBy.get(s.id);
    if (!w) return null;
    if (w.status === "graded") return w.grade === "revise" ? <span className="lab-pill warn">Revise</span> : <span className="lab-pill good">Passed</span>;
    if (w.status === "submitted") return <span className="lab-pill">Submitted</span>;
    return <span className="lab-pill plain">In progress</span>;
  };

  return (
    <div className="lab-wrap"><main className="lab-main lab-stack">
      <div className="lab-stack" style={{ gap: 6 }}>
        <span className="lab-eyebrow">Monarch Tax Lab</span>
        <h1>{instructor ? "Your class" : ctx.isAdmin && !ms ? "Scenario library" : "Your practice returns"}</h1>
        <p className="lab-muted">
          {instructor
            ? "Assign practice from the Monarch library, write your own class scenarios, and review your students’ returns."
            : ctx.isAdmin && !ms
              ? "Write and publish the scenarios every Monarch Tax Lab licensee practices."
              : "Read the client file, complete the intake sheet, prepare the return in the practice software, then check your work."}
        </p>
      </div>
      {sp?.notice ? <div className="lab-notice good">{sp.notice}</div> : null}
      {sp?.error ? <div className="lab-notice bad">{sp.error}</div> : null}

      {ms ? (
        <div className="lab-card lab-row lab-between">
          <span className="lab-small">
            <b>{ms.terms.kind === "instructor" ? "Instructor license" : hasReviewer(ms) ? "Student in an instructor’s class" : "Student license (self-study)"}</b>
            <span className="lab-muted"> · access through {date(ms.terms.expires_at)}</span>
            {instructor ? <span className="lab-muted"> · {seatsUsed(members)} of {ms.terms.seats} student seats used</span> : null}
          </span>
          {instructor ? (
            <span className="lab-row">
              <Link className="lab-btn sm" href="/lab/roster">Manage students</Link>
              <Link className="lab-btn sm" href="/lab/review">Review queue{pending ? ` (${pending})` : ""}</Link>
            </span>
          ) : null}
        </div>
      ) : null}

      {instructor || ctx.isAdmin ? (
        <div className="lab-row">
          {instructor ? <Link className="lab-btn primary" href="/lab/scenarios/new?scope=license">New class scenario</Link> : null}
          {ctx.isAdmin ? <Link className={`lab-btn${instructor ? "" : " primary"}`} href="/lab/scenarios/new?scope=library">New library scenario</Link> : null}
        </div>
      ) : null}

      {scenarios.length === 0 ? (
        <div className="lab-card lab-empty">
          <h2>No scenarios yet</h2>
          <p className="lab-muted">{ctx.isAdmin ? "Create the first one: write the client story, then prepare the answer key in the same software students use." : "New practice scenarios will appear here as soon as they are published."}</p>
        </div>
      ) : (
        <div className="lab-list">
          {scenarios.map((s) => {
            const editable = canEditScenario(ctx, s);
            return (
              <div className="lab-card lab-stack" key={s.id} style={{ gap: 8 }}>
                <div className="lab-row">
                  <span className="lab-pill">{s.level}</span>
                  <span className="lab-pill plain">{s.license_id ? "Class scenario" : "Monarch library"}</span>
                  {s.intake_mode === "interview" ? <span className="lab-pill plain">Interview</span> : null}
                  {s.status === "draft" ? <span className="lab-pill warn">Draft</span> : null}
                  {status(s)}
                </div>
                <h2>{s.title}</h2>
                {s.summary ? <p className="lab-muted">{s.summary}</p> : null}
                <div className="lab-row">
                  {ms && s.status === "published" ? <Link className="lab-btn primary" href={`/lab/s/${s.id}`}>{workBy.has(s.id) ? "Continue" : "Start"}</Link> : null}
                  {editable ? <Link className="lab-btn" href={`/lab/scenarios/${s.id}`}>Edit</Link> : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main></div>
  );
}
