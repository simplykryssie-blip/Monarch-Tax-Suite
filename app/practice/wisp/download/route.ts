import { NextResponse } from "next/server";
import { requirePractice } from "@/lib/practice/server";
import { downloadUrl } from "@/lib/practice/wisp.ts";
import { practiceWispDeps } from "@/lib/practice/wisp-server";

/** A 60-second link to the holder's own WISP PDF, after sign-in and two-step sign-in. */
export async function GET() {
  const ctx = await requirePractice();
  const deps = practiceWispDeps(ctx.tenantId, ctx.userId);
  const w = (await deps.repo.getLive()) ?? (await deps.repo.list())[0] ?? null;
  if (!w?.pdf_path) return new NextResponse("Not found", { status: 404 });
  await deps.audit({ actor_id: ctx.userId, action: "wisp_downloaded", subject_type: "practice_wisp", subject_id: w.id });
  return NextResponse.redirect(await downloadUrl(deps, w), { status: 302, headers: { "cache-control": "no-store" } });
}
