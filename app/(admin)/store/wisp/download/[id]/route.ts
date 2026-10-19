import { requireAdmin } from "@/lib/admin";
import { currentTenantId } from "@/lib/tenants";
import { downloadUrl } from "@/lib/wisp/service.ts";
import { wispDeps } from "@/lib/wisp/server";

/** An administrator's download of a paid WISP (logged as an admin download). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const deps = wispDeps(currentTenantId());
  const plan = await deps.repo.getPlan(id);
  if (!plan || plan.status === "draft") return new Response("Not found", { status: 404 });
  return Response.redirect(await downloadUrl(deps, plan, "admin"), 303);
}
