import { requireAdmin } from "@/lib/admin";
import { documentDeps } from "@/lib/documents/server";
import { fileLink } from "@/lib/documents/service.ts";

// Administrator downloads of an original version, a copy as sent, or a signed copy. The row is looked up through
// the tenant-scoped client (another tenant's id is simply not found) and the file is served by a 60-second link.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function GET(request: Request) {
  await requireAdmin();
  const params = new URL(request.url).searchParams;
  const type = params.get("type");
  const id = params.get("id") ?? "";
  if (!UUID.test(id)) return new Response("Not found", { status: 404 });
  const deps = documentDeps();
  let path: string | null = null;
  let name = "document";
  if (type === "version") {
    const v = await deps.repo.getVersion(id);
    if (v?.status === "ready") ({ storage_path: path, file_name: name } = v);
  } else if (type === "delivery") {
    const d = await deps.repo.getDelivery(id);
    if (d) ({ storage_path: path, file_name: name } = d);
  } else if (type === "signed") {
    const s = await deps.repo.getSignature(id);
    const d = s ? await deps.repo.getDelivery(s.delivery_id) : null;
    if (s?.signed_storage_path && d) {
      path = s.signed_storage_path;
      name = d.file_name.replace(/\.pdf$/i, " (signed).pdf");
    }
  }
  if (!path) return new Response("Not found", { status: 404 });
  // view=1 opens it in the browser tab (PDFs and images); otherwise the browser saves it.
  return Response.redirect(await fileLink(deps, path, params.get("view") === "1" ? null : name), 302);
}
