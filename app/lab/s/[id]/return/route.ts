import { labContext, labRepo } from "@/lib/lab/server";
import { canViewScenario } from "@/lib/lab/service";
import { buildReturnPdf } from "@/lib/lab/pdf";

const fileName = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "return";

/** The signed-in student's saved return for a scenario, as a printable Form 1040 summary. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await labContext();
  if (!ctx) return Response.redirect(new URL(`/login?next=/lab/s/${id}`, request.url), 303);
  if (!ctx.membership) return new Response("Not found", { status: 404 });
  const repo = labRepo();
  const s = await repo.getScenario(id);
  if (!s || !canViewScenario(ctx, s)) return new Response("Not found", { status: 404 });
  const work = await repo.getWork(ctx.membership.member.id, id);
  const pdf = await buildReturnPdf(s.title, work?.ret ?? {});
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${fileName(s.title)}-return-summary.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
