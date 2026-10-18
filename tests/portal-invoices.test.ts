import assert from "node:assert/strict";
import test from "node:test";
import { invoiceNoticeEmail, isOverdue, owed, PORTAL_INVOICE_STATUSES } from "../lib/portal/invoices.ts";

test("only sent and paid invoices show in the portal; never drafts or voids", () => {
  assert.deepEqual([...PORTAL_INVOICE_STATUSES], ["sent", "paid"]);
});

test("the balance never goes below zero", () => {
  assert.equal(owed({ total_cents: 22300, paid_cents: 10000 }), 12300);
  assert.equal(owed({ total_cents: 22300, paid_cents: 30000 }), 0);
});

test("overdue is a fact about the date and the balance", () => {
  const base = { status: "sent" as const, due_on: "2027-03-01", total_cents: 22300, paid_cents: 0 };
  assert.equal(isOverdue(base, "2027-03-02"), true);
  assert.equal(isOverdue(base, "2027-03-01"), false);
  assert.equal(isOverdue({ ...base, due_on: null }, "2027-03-02"), false);
  assert.equal(isOverdue({ ...base, status: "paid" as never }, "2027-03-02"), false);
  assert.equal(isOverdue({ ...base, paid_cents: 22300 }, "2027-03-02"), false);
});

test("the email says who, what and where, with no card or account details", () => {
  const m = invoiceNoticeEmail({ office: "Test Tax Office", name: "Test Client", number: "INV-0001", totalCents: 22300, link: "https://example.com/portal/invoices" });
  assert.match(m.subject, /INV-0001 from Test Tax Office/);
  assert.match(m.text, /\$223\.00/);
  assert.match(m.text, /https:\/\/example\.com\/portal\/invoices/);
});
