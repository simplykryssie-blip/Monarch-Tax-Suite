import assert from "node:assert/strict";
import test from "node:test";
import { addToDay, allocate, checkPlan, nextPaymentCents, splitPlan } from "../lib/workspace/plan.ts";
import { addFeeProduct, addClient, archiveInvoice, createInvoice, editInvoice, removePaymentPlan, saveBillingSettings, setPaymentPlan, recordPayment, voidInvoice } from "../lib/workspace/service.ts";
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

test("an unpaid invoice can be edited and tax is figured again; a plan is dropped when the total changes; a paid-on invoice only takes small edits", async () => {
  const repo = new MemoryWorkspace();
  const c = await addClient(repo, { full_name: "Ada King" }, "u1");
  await saveBillingSettings(repo, { tax_percent: "10" }, "u1");
  const inv = await createInvoice(repo, { client_id: c.id, tax_year: "2025", status: "sent", include_standard: "no", line_label_0: "Prep", line_amount_0: "100", plan_count: "2", plan_first_due: "2026-11-01" }, "u1");
  assert.equal(inv.total_cents, 11000);
  const same = await editInvoice(repo, inv.id, { tax_year: "2025", line_label_0: "Prep", line_amount_0: "100", due_on: "2026-12-01", notes: "Thanks" });
  assert.deepEqual([same.totalChanged, same.planRemoved, same.invoice.due_on, same.invoice.notes], [false, false, "2026-12-01", "Thanks"]);
  assert.equal((await repo.listInstallments([inv.id])).length, 2, "an edit that keeps the total keeps the plan");
  const bigger = await editInvoice(repo, inv.id, { tax_year: "2025", line_label_0: "Prep", line_amount_0: "100", line_label_1: "Rush", line_amount_1: "50", payer: "bank_product" });
  assert.deepEqual([bigger.invoice.total_cents, bigger.invoice.tax_cents, bigger.totalChanged, bigger.planRemoved, bigger.invoice.payer], [16500, 1500, true, true, "bank_product"]);
  assert.equal((await repo.listInstallments([inv.id])).length, 0);
  await assert.rejects(editInvoice(repo, inv.id, { tax_year: "2025" }), /at least one line/);
  await recordPayment(repo, inv.id, "50", "2026-12-01", new Date("2026-12-02"), { method: "cash" });
  const small = await editInvoice(repo, inv.id, { line_label_0: "Ignored", line_amount_0: "1", due_on: "2027-01-01", notes: "Late" });
  assert.deepEqual([small.invoice.total_cents, small.invoice.lines.length, small.invoice.due_on], [16500, 2, "2027-01-01"], "with a payment on it the charges can't change");
  await recordPayment(repo, inv.id, "500", "2026-12-05", new Date("2026-12-06"), { method: "cash" });
  await assert.rejects(editInvoice(repo, inv.id, { due_on: "2027-02-01" }), /can't be edited/);
});

test("only a voided invoice can be archived, and it can be restored", async () => {
  const repo = new MemoryWorkspace();
  const c = await addClient(repo, { full_name: "Ada King" }, "u1");
  const inv = await createInvoice(repo, { client_id: c.id, tax_year: "2025", status: "sent", include_standard: "no", line_label_0: "Prep", line_amount_0: "100" }, "u1");
  await assert.rejects(archiveInvoice(repo, inv.id, true), /Only a voided invoice/);
  await voidInvoice(repo, inv.id);
  assert.ok((await archiveInvoice(repo, inv.id, true)).archived_at);
  assert.equal((await archiveInvoice(repo, inv.id, false)).archived_at, null);
});

test("standard fees on an invoice can't be changed by editing it; only the other charges can", async () => {
  const repo = new MemoryWorkspace();
  const c = await addClient(repo, { full_name: "Ada King" }, "u1");
  await addFeeProduct(repo, { kind: "software", name: "Drake", line_label_0: "Software fee", line_amount_0: "50" }, "u1");
  const inv = await createInvoice(repo, { client_id: c.id, tax_year: "2025", status: "sent", include_standard: "yes", line_label_0: "Rush", line_amount_0: "20" }, "u1");
  assert.deepEqual(inv.lines.map((l) => [l.label, l.standard === true]), [["Software fee", true], ["Rush", false]]);
  // The form sends back only the other charges, and someone posting a changed standard fee gets it ignored.
  const edited = await editInvoice(repo, inv.id, { tax_year: "2025", line_label_0: "Rush", line_amount_0: "30", line_label_1: "Software fee", line_amount_1: "1" });
  assert.deepEqual(edited.invoice.lines.map((l) => [l.label, l.amount_cents, l.standard === true]), [["Software fee", 5000, true], ["Rush", 3000, false], ["Software fee", 100, false]]);
  assert.equal(edited.invoice.total_cents, 8100);
  // Taking out every other charge leaves the standard fees.
  const bare = await editInvoice(repo, inv.id, { tax_year: "2025" });
  assert.deepEqual(bare.invoice.lines.map((l) => l.label), ["Software fee"]);
});
