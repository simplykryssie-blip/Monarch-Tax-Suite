import { requireAdmin } from "@/lib/admin";
import { loadSnapshot, uuid } from "@/lib/efin/service";
import { maskEfin } from "@/lib/efin/rules.ts";

// CSV of the selected rows. EFINs are exported masked (last four only); nothing sensitive leaves the system here.
const cell = (v: unknown) => {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // stop spreadsheet formula injection
  return `"${s.replace(/"/g, '""')}"`;
};

export async function GET(request: Request) {
  await requireAdmin();
  const raw = new URL(request.url).searchParams.get("ids") ?? "";
  const ids = raw.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 500);
  const snap = await loadSnapshot();
  const rows: string[][] = [["Business", "Relationship", "ERO contact", "Locations", "EFIN (masked)", "Internal status", "Verification", "Renewal date", "Renewal date verified", "Archived"]];
  const orgs = new Set<string>();
  for (const entry of ids) {
    const [kind, id] = entry.split(":");
    try { uuid(id); } catch { continue; }
    const efin = kind === "efin" ? snap.efins.find((e) => e.id === id) : undefined;
    const org = snap.orgs.find((o) => o.id === (kind === "org" ? id : efin?.organization_id));
    if (!org || (kind === "org" && orgs.has(org.id))) continue;
    if (kind === "org") orgs.add(org.id);
    const person = snap.people.find((p) => p.id === (efin?.ero_person_id ?? org.administrator_person_id));
    rows.push([org.legal_name, org.relationship, person?.full_name ?? "", String(snap.locations.filter((l) => l.organization_id === org.id && !l.archived_at).length), efin ? maskEfin(efin.efin_last4) : "", efin?.internal_status ?? "", efin?.external_status ?? "", efin?.recorded_expiration ?? "", efin ? (efin.expiration_verified ? "yes" : "no") : "", (efin?.archived_at ?? org.archived_at) ? "yes" : "no"]);
  }
  return new Response(rows.map((r) => r.map(cell).join(",")).join("\r\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="eros-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" } });
}
