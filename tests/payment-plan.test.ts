import assert from "node:assert/strict";
import test from "node:test";
import { addToDay, allocate, checkPlan, nextPaymentCents, splitPlan } from "../lib/workspace/plan.ts";
import { addClient, createInvoice, removePaymentPlan, setPaymentPlan, recordPayment } from "../lib/workspace/service.ts";
import { MemoryWorkspace } from "./workspace-memory.ts";

test("a total splits into equal payments with the odd cents on the first ones", () => {
  const p = splitPlan(10001, 3, "2026-11-30", "month");
  assert.deepEqual(p.map((x) => x.amount_cents), [3334, 3334, 3333]);
  assert.equal(p.reduce((n, x) => n + x.amount_cents, 0), 10001);
  assert.deepEqual(p.map((x) => x.due_on), ["2026-11-30", "2026-12-30", "2027-01-30"]);
  assert.equal(addToDay("2026-01-31", "month", 1), "2026-02-28", "a short month keeps the last day");
  assert.equal(addToDay("2026-11-01", "2weeks", 2), "2026-11-29");
  assert.equal(addToDay("2026-11-01", "week", 1), "2026-11-08");
});

test("what an invoice has been paid counts against the installments oldest first", () => {
  const plan = splitPlan(30000, 3, "2026-11-01", "month");
  const states = (paid: number, today: string) => allocate(plan, paid, today).map((x) => x.state);
  assert.deepEqual(states(0, "2026-10-15"), ["upcoming", "upcoming", "upcoming"]);
  assert.deepEqual(states(10000, "2026-11-15"), ["paid", "upcoming", "upcoming"]);
  assert.deepEqual(states(15000, "2026-11-15"), ["paid", "partial", "upcoming"]);
  assert.deepEqual(states(0, "2026-12-15"), ["overdue", "overdue", "upcoming"]);
  assert.equal(nextPaymentCents(plan, 0), 10000);
  assert.equal(nextPaymentCents(plan, 15000), 5000);
  assert.equal(nextPaymentCents(plan, 30000), null);
  assert.equal(nextPaymentCents([], 0), null);
});

test("a plan from the form needs 2 to 12 payments, a first date, and at least 50 cents each", () => {
  assert.equal(checkPlan({ plan_count: "1" }, 10000), null);
  assert.equal(checkPlan({}, 10000), null);
  assert.throws(() => checkPlan({ plan_count: "13", plan_first_due: "2026-11-01" }, 100000), /2 to 12/);
  assert.throws(() => checkPlan({ plan_count: "3" }, 100000), /first payment/);
  assert.throws(() => checkPlan({ plan_count: "12", plan_first_due: "2026-11-01" }, 500), /at least \$0.50/);
  assert.equal(checkPlan({ plan_count: "4", plan_first_due: "2026-11-01", plan_every: "week" }, 40000)!.length, 4);
});

test("an invoice can be made with a plan, and a plan can be set, replaced and removed until a payment is made", async () => {
  const repo = new MemoryWorkspace();
  const c = await addClient(repo, { full_name: "Ada King" }, "u1");
  const inv = await createInvoice(repo, { client_id: c.id, tax_year: "2025", status: "sent", include_standard: "no", line_label_0: "Prep", line_amount_0: "300", plan_count: "3", plan_first_due: "2026-11-01" }, "u1");
  assert.deepEqual((await repo.listInstallments([inv.id])).map((p) => p.amount_cents), [10000, 10000, 10000]);
  await setPaymentPlan(repo, inv.id, { plan_count: "2", plan_first_due: "2026-12-01" });
  assert.deepEqual((await repo.listInstallments([inv.id])).map((p) => p.amount_cents), [15000, 15000], "setting a plan replaces the old one");
  await removePaymentPlan(repo, inv.id);
  assert.equal((await repo.listInstallments([inv.id])).length, 0);
  await setPaymentPlan(repo, inv.id, { plan_count: "2", plan_first_due: "2026-12-01" });
  await recordPayment(repo, inv.id, "50", "2026-12-01", new Date("2026-12-02"), { method: "cash" });
  await assert.rejects(setPaymentPlan(repo, inv.id, { plan_count: "3", plan_first_due: "2026-12-01" }), /already been made/);
  await assert.rejects(setPaymentPlan(repo, inv.id, { plan_count: "1" }), /already been made/);
});
