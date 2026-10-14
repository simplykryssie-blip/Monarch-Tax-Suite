import { requireOffice } from "@/lib/office/server";
import { can } from "@/lib/office/permissions.ts";
import { complianceDeps } from "@/lib/compliance/server";
import { csvOf } from "@/lib/compliance/csv.ts";
import { DOC_KINDS, type DocKind } from "@/lib/compliance/types.ts";

/** The vault's index as CSV (the same search and filter as the page). Files themselves are opened one by one. */
export async function GET(request: Request) {
  const office = await requireOffice();
  if (!can(office.role, office.permissions, "compliance.vault")) return new Response("Not found", { status: 404 });
  const sp = new URL(request.url).searchParams;
  const kind = (sp.get("kind") ?? "") in DOC_KINDS ? (sp.get("kind") as DocKind) : undefined;
  const deps = complianceDeps(office.tenantId);
  const docs = await deps.repo.listDocuments(office.office.id, { kind, q: (sp.get("q") ?? "").slice(0, 100) });
  await deps.repo.addEvent({ organization_id: office.office.id, entity: "document", record_id: null, action: "vault_exported", actor_id: office.userId, actor_name: office.member?.full_name ?? office.email, reason: null, detail: { count: docs.length } });
  const csv = csvOf(["Title", "Kind", "File type", "Size (bytes)", "Keep until", "Added", "Added by", "SHA-256"], docs.map((d) => [d.title, DOC_KINDS[d.kind], d.file_type, d.size_bytes, d.retention_until, d.created_at.slice(0, 10), d.uploaded_by_name, d.sha256]));
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="vault-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" } });
}
