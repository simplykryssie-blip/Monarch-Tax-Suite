import { requireAdmin } from "@/lib/admin";
import { formDeps } from "@/lib/forms/server";
import { adminPdfLink } from "@/lib/forms/service.ts";

// A submission's PDF, for an administrator: made now if it is still pending, then a 60-second link. Recorded.
export const maxDuration = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function GET(_request: Request, { params }: { params: Promise<{ sid: string }> }) {
  const admin = await requireAdmin();
  const { sid } = await params;
  if (!UUID.test(sid)) return new Response("Not found", { status: 404 });
  try {
    return Response.redirect(await adminPdfLink(formDeps(), sid, admin.userId), 303);
  } catch (e) {
    console.error(`form pdf failed: ${e instanceof Error ? e.message.slice(0, 160) : "unknown"}`);
    return new Response("The PDF could not be made right now. Try again in a minute.", { status: 503 });
  }
}
