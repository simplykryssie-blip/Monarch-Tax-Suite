import { requireAdmin } from "@/lib/admin";
import { documentDeps } from "@/lib/documents/server";
import { numberedBoxesPdf } from "@/lib/documents/merge.ts";

// The current PDF with every fillable box outlined and numbered, so the numbers on the Match the boxes list can be found on the
// form. Nothing is stored and nothing is sent.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  if (!UUID.test(id)) return new Response("Not found", { status: 404 });
  const deps = documentDeps();
  const doc = await deps.repo.getDocument(id);
  const version = doc?.current_version_id ? await deps.repo.getVersion(doc.current_version_id) : null;
  if (!doc || doc.file_type !== "pdf" || !version || version.status !== "ready" || !version.storage_path.startsWith(`${deps.tenantId}/`)) return new Response("Not found", { status: 404 });
  const original = await deps.store.download(version.storage_path);
  if (!original) return new Response("Not found", { status: 404 });
  const out = await numberedBoxesPdf(original).catch(() => null);
  if (!out) return new Response("This PDF has no boxes to show.", { status: 422 });
  return new Response(Buffer.from(out), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": 'inline; filename="boxes.pdf"', "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}
