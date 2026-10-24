// The Home dashboard's numbers and lists, worked out from records the app already holds. Pure: the page loads the records
// (see app/(admin)/page.tsx) and this turns them into cards, ranked priorities and panels. Nothing here is invented: a card
// only appears when its data exists, and a graph is offered only where there is a real series behind it.

import { balance, invoiceView } from "../workspace/rules.ts";
import type { Client, ClientReturn, ClientTask, Invoice } from "../workspace/types.ts";

export type Range = "today" | "week" | "month" | "year";
export const RANGES: { key: Range; label: string }[] = [{ key: "today", label: "Today" }, { key: "week", label: "This week" }, { key: "month", label: "This month" }, { key: "year", label: "This year" }];

export type Tone = "good" | "warn" | "bad" | "plain";
export type StageInfo = { id: string; name: string; color: string; done: boolean };
export type LeadLite = { id: string; full_name: string; source: string; status: string; created_at: string; last_contacted_at: string | null };
export type AgendaSource = { id: string; day: string; time: string; who: string; title: string };

export type HomeInput = {
  /** Today's date in the office's time zone, as YYYY-MM-DD. */
  today: string;
  tomorrow: string;
  /** The tax year the returns cards are about. */
  year: number;
  invoices: Invoice[];
  clients: Client[];
  returns: ClientReturn[];
  stages: StageInfo[];
  tasks: ClientTask[];
  appointments: AgendaSource[];
  /** Null when this account's plan has no Leads section. */
  leads: LeadLite[] | null;
};

export type StatCard = {
  id: string;
  label: string;
  href: string;
  /** "money" values are cents and follow the date range; "count" values are plain numbers. */
  kind: "money" | "count";
  ranged: Record<Range, number> | null;
  value: number;
  sub: string;
  tone: Tone;
  /** The last 7 days, oldest first, when the app really has that history; otherwise null and no graph is offered. */
  series: number[] | null;
};
export type Priority = { id: string; rank: number; who: string; what: string; why: string; tone: Tone; href: string };
export type AgendaItem = { id: string; time: string; title: string; who: string };
export type PanelRow = { id: string; a: string; b: string; chip: string; tone: Tone; href: string };
export type Panel = { id: string; title: string; sub: string; link: string; href: string; rows: PanelRow[] };
export type Stage = { id: string; label: string; count: number; color: string };
export type HomeData = {
  stats: StatCard[];
  priorities: Priority[];
  today: AgendaItem[];
  tomorrow: AgendaItem[];
  panels: Panel[];
  pipeline: Stage[];
  season: { title: string; sub: string; pct: number; note: string };
};

// ------------------------------------------------------------------------------------------------------------- dates

const toMs = (day: string) => Date.parse(`${day}T12:00:00Z`);
export const daysBetween = (from: string, to: string) => Math.round((toMs(to) - toMs(from)) / 86_400_000);
export const addDays = (day: string, n: number) => new Date(toMs(day) + n * 86_400_000).toISOString().slice(0, 10);
const dayOf = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : null);

/** The first day of each range, so "in range" is `from <= day <= today`. */
export function rangeStart(range: Range, today: string): string {
  if (range === "today") return today;
  if (range === "week") return addDays(today, -6);
  if (range === "month") return `${today.slice(0, 7)}-01`;
  return `${today.slice(0, 4)}-01-01`;
}
const inRange = (day: string | null, range: Range, today: string) => Boolean(day && day >= rangeStart(range, today) && day <= today);

/** Days until the next April 15 (the filing deadline), counting from `today`. */
export function daysToDeadline(today: string): { days: number; date: string } {
  const y = Number(today.slice(0, 4));
  const this_ = `${y}-04-15`;
  const date = today <= this_ ? this_ : `${y + 1}-04-15`;
  return { days: daysBetween(today, date), date };
}

// ---------------------------------------------------------------------------------------------------------- the cards

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
export const STUCK_AFTER_DAYS = 5;

export function buildHome(input: HomeInput): HomeData {
  const { today, tomorrow, year, invoices, clients, returns, stages, tasks, appointments, leads } = input;
  const name = new Map(clients.map((c) => [c.id, c.full_name]));
  const stageById = new Map(stages.map((s) => [s.id, s]));
  const doneStage = (id: string) => stageById.get(id)?.done ?? false;
  const live = invoices.filter((i) => i.status !== "void");

  // Money: collected = what has been paid on invoices, by the day it was paid.
  const paid = live.filter((i) => i.paid_on && i.paid_cents > 0);
  const collectedBy = (range: Range) => paid.filter((i) => inRange(i.paid_on, range, today)).reduce((n, i) => n + i.paid_cents, 0);
  const paidCountBy = (range: Range) => paid.filter((i) => i.status === "paid" && inRange(i.paid_on, range, today)).length;
  const filed = returns.filter((r) => !r.archived_at && r.filed_on);
  const filedBy = (range: Range) => filed.filter((r) => inRange(r.filed_on, range, today)).length;
  const last7 = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const collectedSeries = last7.map((d) => paid.filter((i) => i.paid_on === d).reduce((n, i) => n + i.paid_cents, 0));
  const paidSeries = last7.map((d) => paid.filter((i) => i.status === "paid" && i.paid_on === d).length);
  const filedSeries = last7.map((d) => filed.filter((r) => r.filed_on === d).length);
  const ranged = (f: (r: Range) => number): Record<Range, number> => ({ today: f("today"), week: f("week"), month: f("month"), year: f("year") });

  const outstandingInvoices = live.filter((i) => i.status !== "draft" && balance(i) > 0);
  const outstanding = outstandingInvoices.reduce((n, i) => n + balance(i), 0);
  const overdueInvoices = outstandingInvoices.filter((i) => invoiceView(i, today) === "overdue");
  const stats: StatCard[] = [
    { id: "collected", label: "Revenue collected", href: "/workspace/billing", kind: "money", ranged: ranged(collectedBy), value: 0, sub: "paid on invoices", tone: "good", series: collectedSeries },
    { id: "outstanding", label: "Outstanding invoices", href: "/workspace/billing", kind: "money", ranged: null, value: outstanding, sub: overdueInvoices.length ? `${plural(outstandingInvoices.length, "invoice")}, ${overdueInvoices.length} overdue` : plural(outstandingInvoices.length, "invoice"), tone: overdueInvoices.length ? "bad" : "plain", series: null },
    { id: "paid", label: "Invoices paid", href: "/workspace/billing", kind: "count", ranged: ranged(paidCountBy), value: 0, sub: "fully paid", tone: "plain", series: paidSeries },
    { id: "filed", label: "Returns filed", href: "/workspace/work", kind: "count", ranged: ranged(filedBy), value: 0, sub: "marked filed", tone: "plain", series: filedSeries },
  ];

  // Work.
  const yearReturns = returns.filter((r) => !r.archived_at && r.tax_year === year);
  const openReturns = yearReturns.filter((r) => !doneStage(r.stage_id) && !r.filed_on);
  const lateReturns = openReturns.filter((r) => r.due_on && r.due_on < today);
  const openTasks = tasks.filter((t) => !t.done_at);
  const tasksDue = openTasks.filter((t) => t.due_on && t.due_on <= today);
  const tasksOverdue = tasksDue.filter((t) => (t.due_on as string) < today);
  stats.push({ id: "open-returns", label: "Open returns", href: "/workspace/work", kind: "count", ranged: null, value: openReturns.length, sub: lateReturns.length ? `${lateReturns.length} past due` : `tax year ${year}`, tone: lateReturns.length ? "warn" : "plain", series: null });
  stats.push({ id: "tasks-due", label: "Tasks due today", href: "/workspace/work", kind: "count", ranged: null, value: tasksDue.length, sub: tasksOverdue.length ? `${tasksOverdue.length} overdue` : "none overdue", tone: tasksOverdue.length ? "bad" : "plain", series: null });
  if (leads) {
    const waiting = leads.filter((l) => l.status === "new" && !l.last_contacted_at);
    stats.push({ id: "leads-waiting", label: "Leads waiting for a reply", href: "/leads", kind: "count", ranged: null, value: waiting.length, sub: waiting.length ? "no first contact yet" : "all contacted", tone: waiting.length ? "warn" : "plain", series: null });
  }
  stats.push({ id: "clients", label: "Active clients", href: "/contacts", kind: "count", ranged: null, value: clients.filter((c) => !c.archived_at).length, sub: "in your workspace", tone: "plain", series: null });

  // Priorities: fixed weights, so every position can be explained from its inputs.
  const pri: (Priority & { weight: number })[] = [];
  for (const i of overdueInvoices) {
    const late = daysBetween(i.due_on as string, today);
    pri.push({ id: `inv-${i.id}`, rank: 0, weight: 100 + late, who: `${i.number} · ${name.get(i.client_id) ?? "Client"}`, what: `${money(balance(i))} unpaid`, why: `Invoice ${plural(late, "day")} late`, tone: "bad", href: "/workspace/billing" });
  }
  for (const t of tasksDue) {
    const late = daysBetween(t.due_on as string, today);
    pri.push({ id: `task-${t.id}`, rank: 0, weight: late > 0 ? 90 + late : 60, who: t.title, what: `Task · ${name.get(t.client_id) ?? "Client"}`, why: late > 0 ? `${plural(late, "day")} overdue` : "Due today", tone: late > 0 ? "bad" : "warn", href: `/workspace/clients/${t.client_id}?tab=tasks` });
  }
  for (const r of lateReturns) {
    const late = daysBetween(r.due_on as string, today);
    pri.push({ id: `late-${r.id}`, rank: 0, weight: 80 + late, who: `${name.get(r.client_id) ?? "Client"} · ${r.tax_year}`, what: stageById.get(r.stage_id)?.name ?? "In progress", why: `${plural(late, "day")} past due`, tone: "bad", href: `/workspace/clients/${r.client_id}?tab=work` });
  }
  const stuck = openReturns.filter((r) => daysBetween(dayOf(r.updated_at) ?? today, today) >= STUCK_AFTER_DAYS).map((r) => ({ r, days: daysBetween(dayOf(r.updated_at) ?? today, today) })).sort((a, b) => b.days - a.days);
  for (const { r, days } of stuck) {
    if (lateReturns.some((l) => l.id === r.id)) continue;
    pri.push({ id: `stuck-${r.id}`, rank: 0, weight: 40 + Math.min(days, 30), who: `${name.get(r.client_id) ?? "Client"} · ${r.tax_year}`, what: stageById.get(r.stage_id)?.name ?? "In progress", why: `No movement for ${plural(days, "day")}`, tone: "warn", href: `/workspace/clients/${r.client_id}?tab=work` });
  }
  if (leads) {
    for (const l of leads.filter((x) => x.status === "new" && !x.last_contacted_at)) {
      const waited = Math.max(0, daysBetween(dayOf(l.created_at) ?? today, today));
      pri.push({ id: `lead-${l.id}`, rank: 0, weight: 50 + Math.min(waited, 20), who: l.full_name, what: `Lead · ${l.source}`, why: waited ? `Waiting ${plural(waited, "day")}` : "New today", tone: "warn", href: `/leads/${l.id}` });
    }
  }
  const priorities = pri.sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id)).slice(0, 6).map((p, i) => ({ id: p.id, rank: i + 1, who: p.who, what: p.what, why: p.why, tone: p.tone, href: p.href }));

  // Today and tomorrow.
  const agenda = (day: string): AgendaItem[] => [
    ...appointments.filter((a) => a.day === day).sort((a, b) => a.time.localeCompare(b.time)).map((a) => ({ id: `a-${a.id}`, time: a.time, title: a.title, who: a.who })),
    ...openTasks.filter((t) => (day === today ? t.due_on !== null && t.due_on <= day : t.due_on === day)).map((t) => ({ id: `t-${t.id}`, time: "Task", title: t.title, who: name.get(t.client_id) ?? "Client" })),
  ];

  // Panels.
  const row = (id: string, a: string, b: string, chip: string, tone: Tone, href: string): PanelRow => ({ id, a, b, chip, tone, href });
  const panels: Panel[] = [];
  panels.push({
    id: "stuck", title: "Stuck returns", sub: `No movement for ${STUCK_AFTER_DAYS} or more days`, link: "My Work", href: "/workspace/work",
    rows: stuck.slice(0, 5).map(({ r, days }) => row(`s-${r.id}`, `${name.get(r.client_id) ?? "Client"} · ${r.tax_year}`, stageById.get(r.stage_id)?.name ?? "In progress", plural(days, "day"), days >= 10 ? "bad" : "warn", `/workspace/clients/${r.client_id}?tab=work`)),
  });
  const ready = openReturns.filter((r) => r.prep_status === "ready_for_review");
  panels.push({
    id: "ready", title: "Ready for review", sub: "Prepared and waiting for a final look", link: "My Work", href: "/workspace/work",
    rows: ready.slice(0, 5).map((r) => row(`r-${r.id}`, `${name.get(r.client_id) ?? "Client"} · ${r.tax_year}`, stageById.get(r.stage_id)?.name ?? "In progress", "Ready", "good", `/workspace/clients/${r.client_id}?tab=work`)),
  });
  if (leads) {
    const waiting = leads.filter((l) => l.status === "new" && !l.last_contacted_at).sort((a, b) => a.created_at.localeCompare(b.created_at));
    panels.push({
      id: "leads", title: "Leads waiting for a first reply", sub: "Oldest first", link: "Leads", href: "/leads",
      rows: waiting.slice(0, 5).map((l) => { const d = Math.max(0, daysBetween(dayOf(l.created_at) ?? today, today)); return row(`l-${l.id}`, l.full_name, l.source, d ? plural(d, "day") : "today", d >= 2 ? "bad" : "warn", `/leads/${l.id}`); }),
    });
  }

  // The returns pipeline for the year.
  const pipeline: Stage[] = stages.map((s) => ({ id: s.id, label: s.name, color: s.color, count: yearReturns.filter((r) => (stageById.has(r.stage_id) ? r.stage_id : stages[0]?.id) === s.id).length }));

  // Season strip.
  const dl = daysToDeadline(today);
  const total = yearReturns.length;
  const filedThisYear = yearReturns.filter((r) => r.filed_on || doneStage(r.stage_id)).length;
  const season = {
    title: "Filing season",
    sub: `Next deadline: ${new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(toMs(dl.date)))} · ${plural(dl.days, "day")}`,
    pct: total ? Math.round((filedThisYear / total) * 100) : 0,
    note: total ? `${filedThisYear} of ${total} ${year} returns filed` : `No ${year} returns yet`,
  };

  return { stats, priorities, today: agenda(today), tomorrow: agenda(tomorrow), panels, pipeline, season };
}

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}
