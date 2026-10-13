import { requireAdmin } from "@/lib/admin";
import { documentDeps } from "@/lib/documents/server";
import { yearParam } from "@/lib/fees/engine.ts";
import { buildStatementPdf } from "@/lib/fees/pdf.ts";
import { feesDeps } from "@/lib/fees/server";
import { fileSafe, statementCsv, statementFor } from "@/lib/fees/service.ts";

// An office's statement for a season or month, as CSV or PDF, for an administrator. Each export is recorded in the
// fee history.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const { id } = await params;
  if (!UUID.test(id)) return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const year = yearParam(url.searchParams.get("year") ?? undefined);
  const m = Number(url.searchParams.get("month"));
  const month = m >= 1 && m <= 12 ? m : null;
  const format = url.searchParams.get("format") === "pdf" ? "pdf" : "csv";
  const deps = feesDeps();
  const office = (await deps.repo.listOffices()).find((o) => o.id === id);
  if (!office) return new Response("Not found", { status: 404 });
  const [statement, banks] = await Promise.all([statementFor(deps, id, { taxYear: year, month }), deps.repo.listBanks()]);
  await deps.repo.addEvent({ entity: "statement", record_id: null, organization_id: id, action: `statement_${format}`, actor_id: admin.userId, detail: { tax_year: year, month, returns: statement.totals.returns }, reason: null });
  const base = `${fileSafe(office.name)} statement ${year}${month ? `-${String(month).padStart(2, "0")}` : ""}`;
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  if (format === "csv") {
    return new Response(`﻿${statementCsv(office, statement, banks)}`, { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${base}.csv"` } });
  }
  const profile = await documentDeps().repo.getProfile().catch(() => null);
  const bytes = await buildStatementPdf({ bureauName: profile?.display_name || "Monarch Tax Suite", officeName: office.name, statement, banks, generatedAt: new Date() });
  return new Response(Buffer.from(bytes), { headers: { ...headers, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${base}.pdf"` } });
}
