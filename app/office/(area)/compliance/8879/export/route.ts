import { requireOffice } from "@/lib/office/server";
import { can } from "@/lib/office/permissions.ts";
import { complianceDeps } from "@/lib/compliance/server";
import { csvOf } from "@/lib/compliance/csv.ts";
import { retentionState, settingsOf, todayIso } from "@/lib/compliance/rules.ts";
import { LOCATIONS } from "@/lib/compliance/types.ts";

/** The 8879 records as CSV (the page's search and filters). Logged. */
export async function GET(request: Request) {
  const office = await requireOffice();
  if (!can(office.role, office.permissions, "compliance.8879")) return new Response("Not found", { status: 404 });
  const sp = new URL(request.url).searchParams;
  const deps = complianceDeps(office.tenantId);
  const year = Number(sp.get("year"));
  const [records, settings] = await Promise.all([deps.repo.list8879(office.office.id, { q: (sp.get("q") ?? "").slice(0, 100), taxYear: year >= 2000 && year <= 2100 ? year : undefined }), deps.repo.getSettings(office.office.id)]);
  const today = todayIso();
  const alert = settingsOf(settings).retention_alert_days;
  const view = sp.get("view");
  const rows = records.filter((r) => !view || view === "all" || retentionState(r.retention_until, today, alert) === view);
  await deps.repo.addEvent({ organization_id: office.office.id, entity: "8879", record_id: null, action: "exported", actor_id: office.userId, actor_name: office.member?.full_name ?? office.email, reason: null, detail: { count: rows.length } });
  const label = { keep: "In retention", ending: "Ending soon", past: "Past retention" } as const;
  const csv = csvOf(["Tax year", "Return reference", "Taxpayer", "On file since", "Kept in", "Note", "Due date", "IRS received", "Keep until", "Retention", "PDF in vault"],
    rows.map((r) => [r.tax_year, r.return_ref, r.taxpayer_name, r.signed_on, LOCATIONS[r.location], r.location_note, r.due_date, r.received_date, r.retention_until, label[retentionState(r.retention_until, today, alert)], r.document_id ? "yes" : "no"]));
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="8879-records-${today}.csv"`, "Cache-Control": "no-store" } });
}
