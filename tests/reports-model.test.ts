import test from "node:test";
import assert from "node:assert/strict";
import { buildReport } from "../lib/reports/model.ts";

const ret = (o: Record<string, unknown>) => ({ id: "r", tax_year: 2025, stage_id: "s1", archived_at: null, efile_status: "not_sent", federal_result_cents: null, ...o }) as never;
const inv = (o: Record<string, unknown>) => ({ tax_year: 2025, status: "sent", total_cents: 10000, paid_cents: 0, issued_on: "2026-02-10", paid_on: null, ...o }) as never;

test("counts returns by stage and e-file status, and totals results", () => {
  const r = buildReport({
    year: 2025, stages: [{ id: "s1", name: "Intake" }, { id: "s2", name: "Done" }], clients: [], leads: null,
    returns: [ret({}), ret({ stage_id: "s2", efile_status: "accepted", federal_result_cents: 120000 }), ret({ efile_status: "rejected", federal_result_cents: -30000 }), ret({ tax_year: 2024 }), ret({ archived_at: "2026-01-01" })],
    invoices: [],
  });
  assert.equal(r.returnCount, 3);
  assert.deepEqual(r.byStage, [{ name: "Intake", count: 2 }, { name: "Done", count: 1 }]);
  assert.equal(r.byEfile.find((e) => e.key === "accepted")?.count, 1);
  assert.deepEqual(r.federal, { refunds: 120000, owed: 30000 });
});

test("money is counted by month, leaving out drafts and voids", () => {
  const r = buildReport({
    year: 2025, stages: [], returns: [], clients: [{ created_at: "2026-03-01T00:00:00Z" }] as never, leads: [{ source: "booking", status: "new", created_at: "2026-02-01T00:00:00Z" }],
    invoices: [inv({}), inv({ status: "paid", paid_cents: 10000, paid_on: "2026-03-05" }), inv({ status: "void" }), inv({ status: "draft" })],
  });
  assert.equal(r.fees.invoiced, 20000);
  assert.equal(r.fees.collected, 10000);
  assert.equal(r.fees.outstanding, 10000);
  assert.equal(r.months[1].invoiced, 20000);
  assert.equal(r.months[2].collected, 10000);
  assert.equal(r.months[2].newClients, 1);
  assert.equal(r.leadSources[0].source, "booking");
});
