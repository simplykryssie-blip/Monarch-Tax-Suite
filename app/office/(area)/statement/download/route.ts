import { requireOffice } from "@/lib/office/server";
import { can } from "@/lib/office/permissions.ts";
import { documentDeps } from "@/lib/documents/server";
import { yearParam } from "@/lib/fees/engine.ts";
import { buildStatementPdf } from "@/lib/fees/pdf.ts";
import { feesDeps } from "@/lib/fees/server";
import { fileSafe, statementCsv, statementFor } from "@/lib/fees/service.ts";

/** The office's own statement as PDF or CSV. Only for members who can see fees; each download is logged. */
export async function GET(request: Request) {
  const ctx = await requireOffice();
  if (!can(ctx.role, ctx.permissions, "fees.view")) return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const year = yearParam(url.searchParams.get("year") ?? undefined);
  const m = Number(url.searchParams.get("month"));
  const month = m >= 1 && m <= 12 ? m : null;
  const format = url.searchParams.get("format") === "pdf" ? "pdf" : "csv";
  const deps = feesDeps(ctx.tenantId);
  const [statement, banks] = await Promise.all([statementFor(deps, ctx.office.id, { taxYear: year, month }), deps.repo.listBanks()]);
  await deps.repo.addEvent({ entity: "statement", record_id: null, organization_id: ctx.office.id, action: `statement_${format}`, actor_id: ctx.userId, detail: { tax_year: year, month, by: ctx.role }, reason: null });
  const base = `${fileSafe(ctx.office.name)} statement ${year}${month ? `-${String(month).padStart(2, "0")}` : ""}`;
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  const office = { id: ctx.office.id, name: ctx.office.name, archived: false };
  if (format === "csv") return new Response(`﻿${statementCsv(office, statement, banks)}`, { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${base}.csv"` } });
  const profile = await documentDeps(ctx.tenantId).repo.getProfile().catch(() => null);
  const bytes = await buildStatementPdf({ bureauName: profile?.display_name || "Monarch Tax Suite", officeName: ctx.office.name, statement, banks, generatedAt: new Date() });
  return new Response(Buffer.from(bytes), { headers: { ...headers, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${base}.pdf"` } });
}
