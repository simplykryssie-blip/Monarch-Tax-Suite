import { labContext, labRepo } from "@/lib/lab/server";
import { canEditScenario, canViewScenario } from "@/lib/lab/service";
import { buildPacketPdf } from "@/lib/lab/pdf";

const fileName = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "scenario";

/** The printable intake packet. ?kind=instructor adds the notes and answer key, for people who can edit the scenario. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await labContext();
  if (!ctx) return Response.redirect(new URL(`/login?next=/lab/s/${id}`, request.url), 303);
  const repo = labRepo();
  const s = await repo.getScenario(id);
  if (!s || !canViewScenario(ctx, s)) return new Response("Not found", { status: 404 });
  const instructor = new URL(request.url).searchParams.get("kind") === "instructor" && canEditScenario(ctx, s);
  const pdf = await buildPacketPdf(s, { instructor, key: instructor ? await repo.getKey(id) : null });
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${fileName(s.title)}-${instructor ? "instructor" : "intake-packet"}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
