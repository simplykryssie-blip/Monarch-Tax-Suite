import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { addDays, buildHome, daysToDeadline, rangeStart, type HomeInput, type StageInfo } from "../lib/home/model.ts";
import { applyLayout, dropBefore, EMPTY_LAYOUT, moveBy, parseLayout } from "../lib/home/layout.ts";
import type { Client, ClientReturn, ClientTask, Invoice } from "../lib/workspace/types.ts";

// Fake people and dates only.
const TODAY = "2026-10-23";
const stages: StageInfo[] = [{ id: "s1", name: "Intake", color: "#111111", done: false }, { id: "s2", name: "In prep", color: "#222222", done: false }, { id: "s3", name: "Filed", color: "#333333", done: true }];
const client = (n: number, o: Partial<Client> = {}): Client => ({ id: `c${n}`, tenant_id: "t", full_name: `Client ${n}`, email: null, phone: null, ssn_last4: null, address: null, archived_at: null, created_by: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", owner_id: null, organization_id: null, ...o });
const ret = (n: number, o: Partial<ClientReturn> = {}): ClientReturn => ({ id: `r${n}`, tenant_id: "t", client_id: "c1", tax_year: 2025, kind: "original", parent_id: null, stage_id: "s2", due_on: null, filed_on: null, notes: null, archived_at: null, created_at: "2026-10-22T00:00:00Z", updated_at: "2026-10-22T00:00:00Z", assignee_id: null, prep_status: "in_prep", handed_off_at: null, organization_id: null, ...o });
const inv = (n: number, o: Partial<Invoice> = {}): Invoice => ({ id: `i${n}`, tenant_id: "t", client_id: "c1", return_id: null, number: `INV-${n}`, tax_year: 2025, status: "sent", lines: [], total_cents: 10000, paid_cents: 0, issued_on: "2026-10-01", due_on: "2026-10-30", paid_on: null, notes: null, created_by: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", ...o });
const task = (n: number, o: Partial<ClientTask> = {}): ClientTask => ({ id: `t${n}`, tenant_id: "t", client_id: "c1", return_id: null, title: `Task ${n}`, due_on: TODAY, done_at: null, created_by: null, created_at: "2026-10-01T00:00:00Z", ...o });
const base = (o: Partial<HomeInput> = {}): HomeInput => ({ today: TODAY, tomorrow: addDays(TODAY, 1), year: 2025, invoices: [], clients: [client(1), client(2)], returns: [], stages, tasks: [], appointments: [], leads: null, ...o });
const stat = (d: ReturnType<typeof buildHome>, id: string) => d.stats.find((s) => s.id === id)!;

describe("dates", () => {
  test("range starts", () => {
    assert.equal(rangeStart("today", TODAY), TODAY);
    assert.equal(rangeStart("week", TODAY), "2026-10-17");
    assert.equal(rangeStart("month", TODAY), "2026-10-01");
    assert.equal(rangeStart("year", TODAY), "2026-01-01");
  });
  test("the next April 15", () => {
    assert.deepEqual(daysToDeadline("2026-10-23"), { days: 174, date: "2027-04-15" });
    assert.deepEqual(daysToDeadline("2027-04-15"), { days: 0, date: "2027-04-15" });
    assert.equal(daysToDeadline("2027-04-16").date, "2028-04-15");
  });
});

describe("money cards", () => {
  const invoices = [inv(1, { status: "paid", paid_cents: 10000, paid_on: TODAY }), inv(2, { status: "paid", paid_cents: 5000, total_cents: 5000, paid_on: "2026-10-20" }), inv(3, { status: "paid", paid_cents: 7000, total_cents: 7000, paid_on: "2026-03-01" }), inv(4, { status: "sent", total_cents: 20000, due_on: "2026-10-10" }), inv(5, { status: "sent", total_cents: 3000, due_on: "2026-11-30" }), inv(6, { status: "void", total_cents: 99999 }), inv(7, { status: "draft", total_cents: 8888 })];
  test("collected follows the date range, by the day it was paid", () => {
    const c = stat(buildHome(base({ invoices })), "collected");
    assert.deepEqual(c.ranged, { today: 10000, week: 15000, month: 15000, year: 22000 });
  });
  test("outstanding counts sent invoices with a balance and flags overdue ones; void and draft are left out", () => {
    const o = stat(buildHome(base({ invoices })), "outstanding");
    assert.equal(o.value, 23000);
    assert.equal(o.sub, "2 invoices, 1 overdue");
    assert.equal(o.tone, "bad");
  });
  test("a 7-day history exists only where the app really has it", () => {
    const d = buildHome(base({ invoices }));
    assert.equal(stat(d, "collected").series?.length, 7);
    assert.equal(stat(d, "collected").series?.[6], 10000);
    assert.equal(stat(d, "outstanding").series, null);
    assert.equal(stat(d, "open-returns").series, null);
  });
  test("returns filed counts by the day they were filed", () => {
    const d = buildHome(base({ returns: [ret(1, { filed_on: TODAY }), ret(2, { filed_on: "2026-10-01" }), ret(3)] }));
    assert.deepEqual(stat(d, "filed").ranged, { today: 1, week: 1, month: 2, year: 2 });
  });
});

describe("work cards and plans", () => {
  test("the leads card appears only when the plan has leads", () => {
    assert.equal(buildHome(base()).stats.some((s) => s.id === "leads-waiting"), false);
    const d = buildHome(base({ leads: [{ id: "l1", full_name: "Lead One", source: "form", status: "new", created_at: "2026-10-21T00:00:00Z", last_contacted_at: null }, { id: "l2", full_name: "Lead Two", source: "form", status: "contacted", created_at: "2026-10-21T00:00:00Z", last_contacted_at: "2026-10-22T00:00:00Z" }] }));
    assert.equal(stat(d, "leads-waiting").value, 1);
    assert.ok(d.panels.some((p) => p.id === "leads"));
  });
  test("open returns exclude filed and done-stage returns and other years", () => {
    const d = buildHome(base({ returns: [ret(1), ret(2, { stage_id: "s3" }), ret(3, { filed_on: "2026-02-01" }), ret(4, { tax_year: 2024 }), ret(5, { archived_at: "2026-02-01T00:00:00Z" }), ret(6, { due_on: "2026-10-15" })] }));
    assert.equal(stat(d, "open-returns").value, 2);
    assert.equal(stat(d, "open-returns").sub, "1 past due");
  });
  test("tasks due counts open tasks due today or earlier", () => {
    const d = buildHome(base({ tasks: [task(1), task(2, { due_on: "2026-10-20" }), task(3, { due_on: "2026-11-01" }), task(4, { done_at: "2026-10-22T00:00:00Z" }), task(5, { due_on: null })] }));
    assert.equal(stat(d, "tasks-due").value, 2);
    assert.equal(stat(d, "tasks-due").sub, "1 overdue");
  });
});

describe("priorities", () => {
  test("ranked by the fixed weights: late invoice, overdue task, late return, task due today, stuck return, lead", () => {
    const d = buildHome(base({
      invoices: [inv(1, { due_on: "2026-10-14" })],
      tasks: [task(1, { due_on: "2026-10-21" }), task(2)],
      returns: [ret(1, { due_on: "2026-10-18", client_id: "c2" }), ret(2, { updated_at: "2026-10-10T00:00:00Z" })],
      leads: [{ id: "l1", full_name: "Lead One", source: "form", status: "new", created_at: "2026-10-22T00:00:00Z", last_contacted_at: null }],
    }));
    assert.deepEqual(d.priorities.map((p) => p.id.split("-")[0]), ["inv", "task", "late", "task", "stuck", "lead"]);
    assert.deepEqual(d.priorities.map((p) => p.rank), [1, 2, 3, 4, 5, 6]);
    assert.equal(d.priorities[0].why, "Invoice 9 days late");
    assert.equal(d.priorities[1].why, "2 days overdue");
  });
  test("a late return is not also listed as stuck, and the list is capped at six", () => {
    const returns = Array.from({ length: 10 }, (_, i) => ret(i, { updated_at: "2026-10-01T00:00:00Z", due_on: i < 3 ? "2026-10-01" : null }));
    const d = buildHome(base({ returns }));
    assert.equal(d.priorities.length, 6);
    assert.equal(new Set(d.priorities.map((p) => p.id.replace(/^(late|stuck)-/, ""))).size, 6);
  });
  test("nothing urgent gives an empty list", () => {
    assert.deepEqual(buildHome(base()).priorities, []);
  });
});

describe("panels, agenda and pipeline", () => {
  test("stuck returns need five days without movement; ready for review lists prepared returns", () => {
    const d = buildHome(base({ returns: [ret(1, { updated_at: "2026-10-17T00:00:00Z" }), ret(2, { updated_at: "2026-10-19T00:00:00Z" }), ret(3, { prep_status: "ready_for_review" })] }));
    assert.deepEqual(d.panels.find((p) => p.id === "stuck")!.rows.map((r) => r.id), ["s-r1"]);
    assert.deepEqual(d.panels.find((p) => p.id === "ready")!.rows.map((r) => r.id), ["r-r3"]);
  });
  test("today and tomorrow: appointments by day in time order, plus tasks", () => {
    const d = buildHome(base({
      appointments: [{ id: "a2", day: TODAY, time: "4:30 PM", who: "B", title: "Intro" }, { id: "a1", day: TODAY, time: "2:00 PM", who: "A", title: "Review" }, { id: "a3", day: "2026-10-24", time: "10:00 AM", who: "C", title: "Call" }],
      tasks: [task(1), task(2, { due_on: "2026-10-24" })],
    }));
    assert.deepEqual(d.today.map((x) => x.id), ["a-a1", "a-a2", "t-t1"]);
    assert.deepEqual(d.tomorrow.map((x) => x.id), ["a-a3", "t-t2"]);
  });
  test("the pipeline counts this year's returns per stage; a removed stage falls into the first", () => {
    const d = buildHome(base({ returns: [ret(1, { stage_id: "s1" }), ret(2, { stage_id: "s2" }), ret(3, { stage_id: "gone" }), ret(4, { tax_year: 2024 })] }));
    assert.deepEqual(d.pipeline.map((s) => s.count), [2, 1, 0]);
  });
  test("the season strip", () => {
    const d = buildHome(base({ returns: [ret(1, { filed_on: "2026-02-01" }), ret(2), ret(3), ret(4, { stage_id: "s3" })] }));
    assert.equal(d.season.pct, 50);
    assert.equal(d.season.note, "2 of 4 2025 returns filed");
    assert.match(d.season.sub, /April 15, 2027 · 174 days/);
  });
});

describe("layout", () => {
  const ids = ["a", "b", "c", "d"];
  test("anything damaged or unknown is ignored", () => {
    assert.deepEqual(parseLayout(null), EMPTY_LAYOUT);
    assert.deepEqual(parseLayout("not json"), EMPTY_LAYOUT);
    assert.deepEqual(parseLayout("[1]"), EMPTY_LAYOUT);
    const l = parseLayout(JSON.stringify({ order: ["a", 5, "b"], size: { a: "h", b: "huge" }, view: { a: "graph", b: "pie" }, hidden: { c: true, d: false } }));
    assert.deepEqual(l, { order: ["a", "b"], size: { a: "h" }, view: { a: "graph" }, hidden: { c: true } });
  });
  test("a saved order is applied; removed cards drop out and new cards go last", () => {
    const { order, visible, hiddenIds } = applyLayout(ids, { ...EMPTY_LAYOUT, order: ["c", "gone", "a"], hidden: { a: true } });
    assert.deepEqual(order, ["c", "a", "b", "d"]);
    assert.deepEqual(visible, ["c", "b", "d"]);
    assert.deepEqual(hiddenIds, ["a"]);
  });
  test("dragging puts a card before another; moving swaps with the next visible card", () => {
    assert.deepEqual(dropBefore(ids, "d", "b"), ["a", "d", "b", "c"]);
    assert.deepEqual(dropBefore(ids, "a", "a"), ids);
    assert.deepEqual(moveBy(ids, ["a", "c", "d"], "c", -1), ["c", "b", "a", "d"]);
    assert.deepEqual(moveBy(ids, ids, "a", -1), ids, "the first card cannot move earlier");
  });
});

describe("wiring", () => {
  const read = (f: string) => readFileSync(f, "utf8");
  test("Home is behind the admin guard and the layout is kept per person, not shared", () => {
    const page = read("app/(admin)/page.tsx");
    assert.match(page, /await requireAdmin\(\)/);
    assert.match(page, /storageKey=\{`verexa-home-layout:v1:\$\{admin\.userId\}`\}/);
  });
  test("the grid reads and writes only the browser's own storage and calls no server", () => {
    const grid = read("components/home/home-grid.tsx");
    assert.ok(!/fetch\(|"use server"/.test(grid));
    assert.match(grid, /localStorage/);
  });
});
