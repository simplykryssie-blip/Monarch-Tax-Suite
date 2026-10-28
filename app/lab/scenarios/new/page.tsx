import Link from "next/link";
import { redirect } from "next/navigation";
import { ScenarioEditor } from "@/components/lab/scenario-editor";
import { blankReturn, DEFAULT_CHECKS } from "@/lib/lab/engine";
import { requireLab } from "@/lib/lab/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "New scenario" };

/** Library scenarios are written by Monarch administrators; class scenarios by instructors for their own students. */
export default async function NewScenarioPage({ searchParams }: { searchParams?: Promise<{ scope?: string }> }) {
  const ctx = await requireLab("/lab/scenarios/new");
  const scope = (await searchParams)?.scope === "license" ? "license" : "library";
  if (scope === "library" && !ctx.isAdmin) redirect("/lab?error=" + encodeURIComponent("Only Monarch administrators write library scenarios."));
  if (scope === "license" && ctx.membership?.member.role !== "instructor") redirect("/lab?error=" + encodeURIComponent("Only instructors write class scenarios."));
  return (
    <div className="lab-wrap wide"><main className="lab-main lab-stack">
      <Link className="lab-btn ghost" href="/lab">← All scenarios</Link>
      <h1>{scope === "library" ? "New library scenario" : "New class scenario"}</h1>
      <ScenarioEditor initial={{
        id: null, scope, status: "draft", title: "", level: "Beginner", summary: "", narrative: "", factsText: "", intakeMode: "notes",
        docOptions: { household: true, w2: true, int: true, div: true, g: true, r: true, ssa: true, nec: true },
        ret: blankReturn(), checks: [...DEFAULT_CHECKS], overrides: {},
      }} />
    </main></div>
  );
}
