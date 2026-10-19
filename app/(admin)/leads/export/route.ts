import { requireAdmin } from "@/lib/admin";
import { exportCsv, filterFrom } from "@/lib/leads/service.ts";
import { leadsDeps } from "@/lib/leads/server";

// CSV of the leads shown on the Leads page (the same search and filters), up to 10,000.
export async function GET(request: Request) {
  await requireAdmin();
  const sp = Object.fromEntries(new URL(request.url).searchParams);
  const leads = await leadsDeps().repo.listLeads({ ...filterFrom(sp), limit: 10000 });
  return new Response(exportCsv(leads), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" },
  });
}
