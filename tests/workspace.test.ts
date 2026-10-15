import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { balance, buildBoard, checkClient, checkLines, checkReturn, defaultDue, defaultInvoiceLines, invoiceTotal, invoiceView, matchRow, nameMatches, planImport, readBankCsv, readDescription, totals } from "../lib/workspace/rules.ts";
import { DEFAULT_RETURN_STAGES } from "../lib/pipelines/service.ts";
import type { Client, ClientReturn, Invoice } from "../lib/workspace/types.ts";

// My Workspace: clients, the My Work board, invoices and the bank-statement matcher. Fake people only.

const NOW = new Date("2026-10-15T12:00:00Z");
const client = (id: string, name: string, last4: string | null = null): Client => ({ id, tenant_id: "t", full_name: name, email: null, phone: null, ssn_last4: last4, address: null, archived_at: null, created_by: null, created_at: "", updated_at: "" });
const ret = (over: Partial<ClientReturn>): ClientReturn => ({ id: "r1", tenant_id: "t", client_id: "c1", tax_year: 2025, kind: "original", parent_id: null, stage_id: "intake", due_on: "2026-04-15", filed_on: null, notes: null, archived_at: null, created_at: "", updated_at: "", ...over });
const inv = (over: Partial<Invoice>): Invoice => ({ id: "i1", tenant_id: "t", client_id: "c1", return_id: null, number: "INV-0001", tax_year: 2025, status: "sent", lines: defaultInvoiceLines(), total_cents: 22300, paid_cents: 0, issued_on: "2026-02-01", due_on: "2026-03-01", paid_on: null, notes: null, created_by: null, created_at: "", updated_at: "", ...over });

describe("clients and returns", () => {
  test("a client needs a name; email, phone and the SSN's last 4 are checked; only 4 digits are kept", () => {
    assert.throws(() => checkClient({ full_name: " " }), /name/);
    assert.throws(() => checkClient({ full_name: "A", email: "nope" }), /email/);
    assert.throws(() => checkClient({ full_name: "A", ssn_last4: "123-45-6789" }), /last 4 digits/);
    const c = checkClient({ full_name: " Casey   Client ", email: "CASEY@Example.com", phone: "(337) 555-0100", ssn_last4: "1234" });
    assert.deepEqual(c, { full_name: "Casey Client", email: "casey@example.com", phone: "(337) 555-0100", ssn_last4: "1234", address: null });
  });

  test("one original and one extension per client per year; amendments can repeat; extension and amendment cards link to the original", () => {
    const orig = ret({ id: "o" });
    assert.throws(() => checkReturn({ client_id: "c1", tax_year: "2025", kind: "original" }, [orig], NOW), /already has an original/);
    const ext = checkReturn({ client_id: "c1", tax_year: "2025", kind: "extension" }, [orig], NOW);
    assert.equal(ext.parent_id, "o");
    assert.equal(ext.due_on, "2026-10-15");
    assert.throws(() => checkReturn({ client_id: "c1", tax_year: "2025", kind: "extension" }, [orig, ret({ id: "e", kind: "extension" })], NOW), /already has an extension/);
    assert.equal(checkReturn({ client_id: "c1", tax_year: "2025", kind: "amendment" }, [orig, ret({ id: "a", kind: "amendment" })], NOW).parent_id, "o");
    assert.throws(() => checkReturn({ client_id: "c1", tax_year: "1999" }, [], NOW), /tax year/);
    assert.equal(defaultDue(2025, "original"), "2026-04-15");
  });

  test("the board has a column per stage, a card per return (extensions and amendments separate), filtered by year, with removed stages falling back to the first", () => {
    const clients = new Map([["c1", client("c1", "Casey Client")], ["c2", client("c2", "Dana Doe")]]);
    const returns = [
      ret({ id: "a", client_id: "c1", stage_id: "preparing" }),
      ret({ id: "b", client_id: "c1", kind: "extension", parent_id: "a", stage_id: "intake", due_on: "2026-10-15" }),
      ret({ id: "c", client_id: "c2", stage_id: "gone-stage", due_on: "2026-04-01" }),
      ret({ id: "d", client_id: "c2", tax_year: 2024 }),
      ret({ id: "e", client_id: "c2", archived_at: "2026-01-01" }),
    ];
    const cols = buildBoard(DEFAULT_RETURN_STAGES, returns, clients, 2025, "2026-10-15");
    assert.equal(cols.length, 8);
    const at = (id: string) => cols.find((c) => c.stage.id === id)!.cards.map((x) => x.id);
    assert.deepEqual(at("preparing"), ["a"]);
    assert.deepEqual(at("intake"), ["c", "b"], "a removed stage's card shows first; cards sort by due date");
    assert.equal(cols.flatMap((c) => c.cards).length, 3, "other years and archived returns are not on the board");
    assert.equal(cols[0].cards[0].late, true);
    assert.equal(cols.flatMap((c) => c.cards).find((x) => x.id === "b")!.kind, "extension");
  });
});

describe("invoices", () => {
  test("the default lines are the $223 breakdown, and typed lines are checked", () => {
    const lines = defaultInvoiceLines();
    assert.deepEqual(lines.map((l) => l.amount_cents), [7900, 2100, 2400, 9900]);
    assert.equal(invoiceTotal(lines), 22300);
    assert.deepEqual(checkLines({ line_label_0: "Service", line_amount_0: "$79.50", line_label_1: "", line_amount_1: "" }), [{ label: "Service", amount_cents: 7950 }]);
    assert.throws(() => checkLines({}), /at least one line/);
    assert.throws(() => checkLines({ line_label_0: "X", line_amount_0: "abc" }), /amount/);
    assert.throws(() => checkLines({ line_label_0: "", line_amount_0: "5" }), /description/);
  });

  test("balance, overdue and the totals", () => {
    const sent = inv({ due_on: "2026-10-01" });
    assert.equal(invoiceView(sent, "2026-10-15"), "overdue");
    assert.equal(invoiceView(inv({ due_on: "2026-12-01" }), "2026-10-15"), "sent");
    assert.equal(invoiceView(inv({ status: "paid", paid_cents: 22300, due_on: "2026-10-01" }), "2026-10-15"), "paid");
    assert.equal(balance(inv({ paid_cents: 10000 })), 12300);
    const t = totals([sent, inv({ id: "i2", status: "paid", paid_cents: 22300 }), inv({ id: "i3", status: "draft" }), inv({ id: "i4", status: "void" })], "2026-10-15");
    assert.deepEqual(t, { invoiced: 66900, collected: 22300, outstanding: 22300, overdue: 22300, count: 3 });
  });
});

describe("bank statement matching", () => {
  const clients = new Map([["c1", client("c1", "Casey Client", "1234")], ["c2", client("c2", "Dana Doe", "9876")], ["c3", client("c3", "Casey Clientson", "5555")]]);
  const open = [inv({ id: "i1", client_id: "c1", tax_year: 2025 }), inv({ id: "i2", client_id: "c2", tax_year: 2025 }), inv({ id: "i3", client_id: "c1", tax_year: 2024, number: "INV-0002" })];

  test("reads the tax year, last 4 and name from a description", () => {
    assert.deepEqual(readDescription("ACH DEPOSIT CLIENT, CASEY SSN 1234 TY2025 TAX PREP", NOW), { taxYear: 2025, last4: "1234", name: "CLIENT CASEY" });
    assert.deepEqual(readDescription("Zelle from Dana Doe xxx-xx-9876 tax year 2025", NOW), { taxYear: 2025, last4: "9876", name: "Dana Doe" });
    assert.deepEqual(readDescription("Deposit Dana Doe 2025 9876", NOW).last4, "9876");
    assert.equal(readDescription("Deposit Dana Doe 2025 9876", NOW).taxYear, 2025);
    assert.deepEqual([readDescription("Deposit from somebody", NOW).taxYear, readDescription("Deposit from somebody", NOW).last4], [null, null]);
  });

  test("name matching needs every name word, so Casey Client is not Casey Clientson", () => {
    assert.equal(nameMatches("Casey Client", "ACH CASEY CLIENT SSN 1234"), true);
    assert.equal(nameMatches("Casey Client", "ACH CASEY CLIENTSON"), false);
    assert.equal(nameMatches("Casey Client", "ACH DANA DOE"), false);
  });

  test("tax year, name and last 4 all agree: exact; two of three: possible; a contradiction or no name: none", () => {
    const row = (description: string, amount = 22300) => { const r = readDescription(description, NOW); return { description, amount_cents: amount, taxYear: r.taxYear, last4: r.last4 }; };
    assert.deepEqual(matchRow(row("ACH CASEY CLIENT SSN 1234 TY2025"), open, clients), { invoiceId: "i1", match: "exact" });
    assert.deepEqual(matchRow(row("ACH CASEY CLIENT TY2025"), open, clients), { invoiceId: "i1", match: "possible" });
    assert.deepEqual(matchRow(row("ACH CASEY CLIENT SSN 1234"), open, clients).match, "possible");
    assert.deepEqual(matchRow(row("ACH CASEY CLIENT SSN 9999 TY2025"), open, clients), { invoiceId: null, match: "none" });
    assert.deepEqual(matchRow(row("ACH SOMEBODY SSN 1234 TY2025"), open, clients), { invoiceId: null, match: "none" });
    assert.deepEqual(matchRow(row("ACH CASEY CLIENT SSN 1234 TY2024"), open, clients), { invoiceId: "i3", match: "exact" });
  });

  test("a paid or void invoice is never matched, and two invoices for one year prefer the one the amount fits", () => {
    const paid = [inv({ id: "p", client_id: "c1", status: "paid", paid_cents: 22300 })];
    assert.equal(matchRow({ description: "CASEY CLIENT 1234 TY2025", amount_cents: 22300, taxYear: 2025, last4: "1234" }, paid, clients).match, "none");
    const two = [inv({ id: "orig", client_id: "c1", issued_on: "2026-01-01" }), inv({ id: "amend", client_id: "c1", total_cents: 5000, number: "INV-0003", issued_on: "2026-06-01" })];
    assert.deepEqual(matchRow({ description: "CASEY CLIENT 1234 TY2025", amount_cents: 5000, taxYear: 2025, last4: "1234" }, two, clients), { invoiceId: "amend", match: "exact" });
    assert.equal(matchRow({ description: "CASEY CLIENT 1234 TY2025", amount_cents: 7000, taxYear: 2025, last4: "1234" }, [two[0], inv({ id: "dup", client_id: "c1", number: "INV-0004" })], clients).match, "possible");
  });

  test("reads a bank CSV: deposits only, either an Amount or a Credit column, dates in either style", () => {
    const csv = "Date,Description,Amount\n10/01/2026,ACH CASEY CLIENT SSN 1234 TY2025,$223.00\n2026-10-02,POS PURCHASE OFFICE SUPPLY,-45.10\n10/03/2026,\"Zelle, Dana Doe 9876 2025\",223\n10/04/2026,Zero,0.00\n";
    const { lines, skipped } = readBankCsv(csv);
    assert.deepEqual(lines.map((l) => [l.row_no, l.posted_on, l.amount_cents]), [[2, "2026-10-01", 22300], [4, "2026-10-03", 22300]]);
    assert.equal(skipped, 2);
    const credit = readBankCsv("Posted Date,Memo,Debit,Credit\n2026-10-01,DEPOSIT CASEY CLIENT,,223.00\n2026-10-02,FEE,10.00,\n");
    assert.equal(credit.lines.length, 1);
    assert.throws(() => readBankCsv("Foo,Bar\n1,2\n"), /columns/);
    assert.throws(() => readBankCsv("Date,Description,Amount\n"), /no rows/);
    assert.throws(() => readBankCsv("Date,Description,Amount\n2026-10-01,x,-5\n"), /No deposits/);
  });

  test("planning an import reads each deposit and matches it, leaving every row for review", () => {
    const { lines } = readBankCsv("Date,Description,Amount\n10/01/2026,ACH CASEY CLIENT SSN 1234 TY2025,223.00\n10/02/2026,ACH DANA DOE TY2025,100\n10/03/2026,UNKNOWN PERSON,50\n");
    const rows = planImport("imp", lines, open, clients, NOW);
    assert.deepEqual(rows.map((r) => [r.match, r.invoice_id, r.tax_year, r.ssn_last4]), [["exact", "i1", 2025, "1234"], ["possible", "i2", 2025, null], ["none", null, null, null]]);
  });
});

// ---------------------------------------------------------------- the service, on the in-memory workspace

import { addClient, addNote, addReturn, addTask, applyImport, createInvoice, discardImport, logMessage, moveReturn, recordPayment, saveReview, sendInvoice, setTaskDone, startImport, voidInvoice } from "../lib/workspace/service.ts";
import { MemoryWorkspace } from "./workspace-memory.ts";

const ADMIN = "00000000-0000-4000-8000-00000000ad01";
const STAGES = DEFAULT_RETURN_STAGES.map((s) => s.id);

describe("workspace service", () => {
  test("a client's returns, board moves, tasks, notes and messages", async () => {
    const repo = new MemoryWorkspace();
    const casey = await addClient(repo, { full_name: "Casey Client", ssn_last4: "1234" }, ADMIN);
    const r = await addReturn(repo, { client_id: casey.id, tax_year: "2025" }, "intake", NOW);
    assert.equal(r.stage_id, "intake");
    await assert.rejects(addReturn(repo, { client_id: casey.id, tax_year: "2025" }, "intake", NOW), /already has an original/);
    await assert.rejects(addReturn(repo, { client_id: "nope", tax_year: "2025" }, "intake", NOW), /wasn't found/);
    const moved = await moveReturn(repo, r.id, "preparing", STAGES, NOW);
    assert.equal(moved.stage_id, "preparing");
    await assert.rejects(moveReturn(repo, r.id, "mystery", STAGES, NOW), /isn't in the pipeline/);
    const done = await moveReturn(repo, r.id, "complete", STAGES, NOW);
    assert.equal(done.filed_on, "2026-10-15", "reaching the last stage stamps the filed date");
    const t = await addTask(repo, casey.id, { title: "Call about W-2", due_on: "2026-10-20", return_id: r.id }, ADMIN);
    await assert.rejects(addTask(repo, casey.id, { title: "x", return_id: "00000000-0000-4000-8000-000000000999" }, ADMIN), /isn't this client's/);
    assert.ok((await setTaskDone(repo, t.id, true, NOW)).done_at);
    assert.equal((await repo.listTasks({ openOnly: true })).length, 0);
    await assert.rejects(addNote(repo, casey.id, "  ", ADMIN), /Write the note/);
    await addNote(repo, casey.id, "Prefers text", ADMIN);
    const m = await logMessage(repo, casey.id, { channel: "call", direction: "in", body: "Said W-2 is coming", occurred_at: "2026-10-14" }, ADMIN, NOW);
    assert.deepEqual([m.channel, m.direction, m.occurred_at.slice(0, 10)], ["call", "in", "2026-10-14"]);
  });

  test("an invoice defaults to the $223 breakdown, numbers run on, and payments settle it", async () => {
    const repo = new MemoryWorkspace();
    const casey = await addClient(repo, { full_name: "Casey Client" }, ADMIN);
    const a = await createInvoice(repo, { client_id: casey.id, tax_year: "2025", due_on: "2026-11-01" }, ADMIN, NOW);
    const b = await createInvoice(repo, { client_id: casey.id, tax_year: "2025", line_label_0: "Amendment", line_amount_0: "100" }, ADMIN, NOW);
    assert.deepEqual([a.number, a.total_cents, a.status, b.number, b.total_cents], ["INV-0001", 22300, "draft", "INV-0002", 10000]);
    await assert.rejects(createInvoice(repo, { client_id: casey.id, tax_year: "1990" }, ADMIN, NOW), /tax year/);
    assert.equal((await sendInvoice(repo, a.id)).status, "sent");
    await assert.rejects(sendInvoice(repo, a.id), /Only a draft/);
    const part = await recordPayment(repo, a.id, "100", "2026-10-10", NOW);
    assert.deepEqual([part.paid_cents, part.status], [10000, "sent"]);
    await assert.rejects(voidInvoice(repo, a.id), /payment on it/);
    const full = await recordPayment(repo, a.id, "123", "2026-10-12", NOW);
    assert.deepEqual([full.paid_cents, full.status, full.paid_on], [22300, "paid", "2026-10-12"]);
    await assert.rejects(recordPayment(repo, a.id, "abc", "", NOW), /amount received/);
    assert.equal((await voidInvoice(repo, b.id)).status, "void");
  });

  test("a bank CSV is read into a review, edited by hand, and applied only for the rows chosen", async () => {
    const repo = new MemoryWorkspace();
    const casey = await addClient(repo, { full_name: "Casey Client", ssn_last4: "1234" }, ADMIN);
    const dana = await addClient(repo, { full_name: "Dana Doe", ssn_last4: "9876" }, ADMIN);
    const i1 = await sendInvoice(repo, (await createInvoice(repo, { client_id: casey.id, tax_year: "2025" }, ADMIN, NOW)).id);
    const i2 = await sendInvoice(repo, (await createInvoice(repo, { client_id: dana.id, tax_year: "2025" }, ADMIN, NOW)).id);
    const csv = "Date,Description,Amount\n10/01/2026,ACH CASEY CLIENT SSN 1234 TY2025,223.00\n10/02/2026,ACH DANA DOE TY2025,100.00\n10/03/2026,UNKNOWN PERSON,50.00\n10/04/2026,Rent,-900\n";
    const started = await startImport(repo, "oct.csv", csv, ADMIN, NOW);
    assert.equal(started.rows.length, 3);
    assert.equal(started.skipped, 1);
    assert.deepEqual(started.rows.map((r) => r.match), ["exact", "possible", "none"]);
    assert.equal((await repo.getInvoice(i1.id))!.paid_cents, 0, "nothing is applied by reading the file");
    assert.equal((await startImport(repo, "oct-again.csv", csv, ADMIN, NOW)).duplicateOf?.id, started.import.id, "the same file is flagged");

    const [r1, r2, r3] = started.rows;
    // The user fixes row 2's amount to the full balance, points row 3 at Dana's invoice, then applies rows 1 and 2 only.
    await saveReview(repo, started.import.id, [
      { rowId: r1.id, invoiceId: i1.id, amount: "223.00", ignore: false },
      { rowId: r2.id, invoiceId: i2.id, amount: "223.00", ignore: false },
      { rowId: r3.id, invoiceId: i2.id, amount: "50", ignore: false },
    ]);
    assert.deepEqual((await repo.listImportRows(started.import.id)).map((r) => r.match), ["exact", "possible", "manual"]);
    const first = await applyImport(repo, started.import.id, [r1.id, r2.id], NOW);
    assert.deepEqual(first, { applied: 2, overpaid: 0 });
    assert.deepEqual([(await repo.getInvoice(i1.id))!.status, (await repo.getInvoice(i2.id))!.status], ["paid", "paid"]);
    assert.equal((await repo.getImport(started.import.id))!.status, "review", "row 3 is still waiting");
    assert.deepEqual(await applyImport(repo, started.import.id, [r1.id], NOW), { applied: 0, overpaid: 0 }, "a row is applied at most once");
    assert.equal((await repo.getInvoice(i1.id))!.paid_cents, 22300);
    // Row 3 is sent to an invoice that is already paid: it is applied, capped at the total, and counted as an overpayment.
    assert.deepEqual(await applyImport(repo, started.import.id, [r3.id], NOW), { applied: 1, overpaid: 1 });
    assert.equal((await repo.getInvoice(i2.id))!.paid_cents, 22300);
    assert.equal((await repo.getImport(started.import.id))!.status, "applied");
    await assert.rejects(applyImport(repo, started.import.id, [r1.id], NOW), /already finished/);
    await assert.rejects(discardImport(repo, started.import.id), /already applied/);
  });

  test("rows can be ignored or left without an invoice, and an import can be discarded before anything is applied", async () => {
    const repo = new MemoryWorkspace();
    const casey = await addClient(repo, { full_name: "Casey Client", ssn_last4: "1234" }, ADMIN);
    const inv1 = await sendInvoice(repo, (await createInvoice(repo, { client_id: casey.id, tax_year: "2025" }, ADMIN, NOW)).id);
    const started = await startImport(repo, "x.csv", "Date,Description,Amount\n10/01/2026,ACH CASEY CLIENT SSN 1234 TY2025,223.00\n10/02/2026,MYSTERY,40\n", ADMIN, NOW);
    const [a, b] = started.rows;
    await saveReview(repo, started.import.id, [{ rowId: a.id, invoiceId: null, amount: "223", ignore: false }, { rowId: b.id, invoiceId: null, amount: "40", ignore: true }]);
    assert.deepEqual((await repo.listImportRows(started.import.id)).map((r) => [r.status, r.invoice_id, r.match]), [["pending", null, "none"], ["ignored", null, "none"]]);
    await assert.rejects(applyImport(repo, started.import.id, [a.id], NOW), /choose an invoice/);
    await assert.rejects(saveReview(repo, started.import.id, [{ rowId: a.id, invoiceId: inv1.id, amount: "abc", ignore: false }]), /amount to apply/);
    await discardImport(repo, started.import.id);
    assert.equal((await repo.getImport(started.import.id))!.status, "discarded");
    assert.equal((await repo.getInvoice(inv1.id))!.paid_cents, 0);
  });
});
