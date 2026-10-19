import { requireAdmin } from "@/lib/admin";
import { formDeps } from "@/lib/forms/server";
import { uploadLink } from "@/lib/forms/service.ts";

// An uploaded file, for an administrator: a redirect to a 60-second link to the tenant's own file. Recorded.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function GET(request: Request, { params }: { params: Promise<{ uploadId: string }> }) {
  const admin = await requireAdmin();
  const { uploadId } = await params;
  if (!UUID.test(uploadId)) return new Response("Not found", { status: 404 });
  try {
    return Response.redirect(await uploadLink(formDeps(), uploadId, admin.userId, new URL(request.url).searchParams.get("download") === "1"), 303);
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
