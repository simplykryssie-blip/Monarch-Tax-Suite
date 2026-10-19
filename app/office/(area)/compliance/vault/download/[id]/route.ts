import { requireOffice } from "@/lib/office/server";
import { complianceDeps, ctxFor } from "@/lib/compliance/server";
import { UUID, vaultDownload } from "@/lib/compliance/service.ts";
import { ValidationError } from "@/lib/commerce/validation.ts";

/** Opens a vault file through a one-minute signed link. Only the office's own files; each download is logged. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const office = await requireOffice();
  const { id } = await params;
  if (!UUID.test(id)) return new Response("Not found", { status: 404 });
  try {
    const url = await vaultDownload(complianceDeps(office.tenantId), ctxFor(office), id);
    return Response.redirect(url, 302);
  } catch (e) {
    if (e instanceof ValidationError) return new Response(e.message, { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
    throw e;
  }
}
