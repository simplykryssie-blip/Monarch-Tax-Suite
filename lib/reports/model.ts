// The Reports page's numbers, worked out from records the app already holds. Pure: the page loads the records and this
// counts them. Money is in cents; a refund is positive and an amount owed is negative.

import { EFILE_STATUSES } from "../workspace/types.ts";
import type { Client, ClientReturn, Invoice } from "../workspace/types.ts";

export type LeadRow = { source: string; status: string; created_at: string };
export type ReportInput = { year: number; returns: ClientReturn[]; invoices: Invoice[]; clients: Client[]; leads: LeadRow[] | null; stages: { id: string; name: string }[] };

export type MonthRow = { month: string; invoiced: number; collected: number; newClients: number; newLeads: number };
export type Report = {
  year: number;
  returnCount: number;
  byStage: { name: string; count: number }[];
  byEfile: { key: string; label: string; count: number }[];
  federal: { refunds: number; owed: number };
  fees: { invoiced: number; collected: number; outstanding: number };
  months: MonthRow[];
  leadSources: { source: string; count: number }[];
  leadStatuses: { status: string; count: number }[];
};

const monthOf = (iso: string | null | undefined, year: number): number | null => {
  if (!iso || iso.length < 7 || Number(iso.slice(0, 4)) !== year) return null;
  const m = Number(iso.slice(5, 7));
  return m >= 1 && m <= 12 ? m : null;
};

export function buildReport(input: ReportInput): Report {
  const { year } = input;
  // A tax year is worked the next calendar year (2025 returns are prepared in 2026), so the months are those of year + 1.
  const season = year + 1;
  const returns = input.returns.filter((r) => r.tax_year === year && !r.archived_at);
  const stageCounts = new Map<string, number>();
  for (const r of returns) stageCounts.set(r.stage_id, (stageCounts.get(r.stage_id) ?? 0) + 1);
  const efile = new Map<string, number>();
  for (const r of returns) { const k = r.efile_status ?? "not_sent"; efile.set(k, (efile.get(k) ?? 0) + 1); }
  let refunds = 0;
  let owed = 0;
  for (const r of returns) {
    const v = r.federal_result_cents;
    if (typeof v === "number") { if (v >= 0) refunds += v; else owed += -v; }
  }

  const invoices = input.invoices.filter((i) => i.tax_year === year && i.status !== "void" && i.status !== "draft");
  const months: MonthRow[] = Array.from({ length: 12 }, (_, i) => ({ month: new Date(Date.UTC(season, i, 1)).toLocaleString("en-US", { month: "short", timeZone: "UTC" }), invoiced: 0, collected: 0, newClients: 0, newLeads: 0 }));
  for (const i of invoices) {
    const m = monthOf(i.issued_on, season);
    if (m) months[m - 1].invoiced += i.total_cents;
    const p = monthOf(i.paid_on ?? null, season);
    if (p) months[p - 1].collected += i.paid_cents;
  }
  for (const c of input.clients) { const m = monthOf(c.created_at, season); if (m) months[m - 1].newClients++; }
  const leads = (input.leads ?? []).filter((l) => monthOf(l.created_at, season));
  for (const l of leads) months[monthOf(l.created_at, season)! - 1].newLeads++;

  const count = (rows: string[]) => { const m = new Map<string, number>(); for (const k of rows) m.set(k, (m.get(k) ?? 0) + 1); return [...m].map(([k, n]) => [k, n] as const).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])); };
  return {
    year,
    returnCount: returns.length,
    byStage: input.stages.map((s) => ({ name: s.name, count: stageCounts.get(s.id) ?? 0 })),
    byEfile: Object.entries(EFILE_STATUSES).map(([key, label]) => ({ key, label, count: efile.get(key) ?? 0 })),
    federal: { refunds, owed },
    fees: {
      invoiced: invoices.reduce((n, i) => n + i.total_cents, 0),
      collected: invoices.reduce((n, i) => n + i.paid_cents, 0),
      outstanding: invoices.reduce((n, i) => n + Math.max(0, i.total_cents - i.paid_cents), 0),
    },
    months,
    leadSources: count(leads.map((l) => l.source || "unknown")).map(([source, n]) => ({ source, count: n })),
    leadStatuses: count(leads.map((l) => l.status)).map(([status, n]) => ({ status, count: n })),
  };
}
