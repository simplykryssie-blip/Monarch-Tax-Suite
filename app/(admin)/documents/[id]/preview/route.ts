import { requireAdmin } from "@/lib/admin";
import { documentDeps } from "@/lib/documents/server";
import { SAMPLE_FIELD_VALUES } from "@/lib/documents/fields.ts";
import { CONTENT_TYPES } from "@/lib/documents/files.ts";
import { fillTemplate } from "@/lib/documents/merge.ts";

// The current version filled with obviously fake sample values, for the administrator to check the layout.
// Nothing is stored and nothing is sent.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  if (!UUID.test(id)) return new Response("Not found", { status: 404 });
  const deps = documentDeps();
  const doc = await deps.repo.getDocument(id);
  const version = doc?.current_version_id ? await deps.repo.getVersion(doc.current_version_id) : null;
  if (!doc || !version || version.status !== "ready" || !version.storage_path.startsWith(`${deps.tenantId}/`)) return new Response("Not found", { status: 404 });
  const original = await deps.store.download(version.storage_path);
  if (!original) return new Response("Not found", { status: 404 });
  const sample = { ...SAMPLE_FIELD_VALUES };
  for (const f of version.merge_fields) if (f.startsWith("form.")) sample[f] = `Sample ${f.slice(5).replace(/_/g, " ")}`;
  const filled = await fillTemplate(original, doc.file_type, sample);
  const name = `${doc.name.replace(/[^A-Za-z0-9._ -]/g, "_").slice(0, 100)} (sample).${doc.file_type}`;
  return new Response(Buffer.from(filled), {
    headers: {
      "Content-Type": CONTENT_TYPES[doc.file_type],
      "Content-Disposition": `${doc.file_type === "pdf" ? "inline" : "attachment"}; filename="${name}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
