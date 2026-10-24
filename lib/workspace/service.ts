import { createHash } from "node:crypto";
import { ValidationError } from "../commerce/validation.ts";
import { parseMoney } from "../fees/engine.ts";
import { balance, checkBusiness, checkClient, checkDependent, checkLines, checkReturn, checkTask, defaultInvoiceLines, invoiceTotal, isDay, planImport, readBankCsv } from "./rules.ts";
import type { Client, ClientReturn, Invoice, InvoiceStatus, PaymentImport, PaymentRow, WorkspaceRepo } from "./types.ts";

// My Workspace orchestration: each function checks its input with the rules, then uses the repository. Nothing here
// reaches outside the tenant: the repository is built on the tenant-scoped database client.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (v: unknown, what: string) => {
  if (typeof v !== "string" || !UUID.test(v)) throw new ValidationError(`${what} wasn't found.`);
  return v;
};
const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim().slice(0, max) : "");

// ---------------------------------------------------------------- clients, returns, tasks, notes, messages

/** The preparer who adds a client owns them; `organizationId` is the office whose team entered them (none for the account's own). */
export async function addClient(repo: WorkspaceRepo, raw: Record<string, unknown>, actorId: string, organizationId: string | null = null): Promise<Client> {
  return repo.insertClient({ ...checkClient(raw), created_by: actorId, owner_id: actorId, organization_id: organizationId });
}

export async function saveClient(repo: WorkspaceRepo, id: string, raw: Record<string, unknown>): Promise<Client> {
  if (!(await repo.getClient(uuid(id, "That client")))) throw new ValidationError("That client wasn't found.");
  return repo.updateClient(id, checkClient(raw));
}

/** A new return is worked by `assigneeId` (when given) and belongs to the client's office. */
export async function addReturn(repo: WorkspaceRepo, raw: Record<string, unknown>, firstStage: string, now = new Date(), assigneeId: string | null = null): Promise<ClientReturn> {
  const clientId = uuid(raw.client_id, "That client");
  const client = await repo.getClient(clientId);
  if (!client) throw new ValidationError("That client wasn't found.");
  const existing = await repo.listReturns({ clientId, includeArchived: false });
  const r = checkReturn({ ...raw, client_id: clientId }, existing, now);
  try {
    return await repo.insertReturn({ ...r, stage_id: firstStage, assignee_id: assigneeId ?? client.owner_id, organization_id: client.organization_id });
  } catch (e) {
    if (/client_returns_one_per_year|duplicate key/i.test(e instanceof Error ? e.message : "")) throw new ValidationError("This client already has that return for that year.");
    throw e;
  }
}

/** Moves a card to another stage (the board's drag and drop). The stage must be one of the pipeline's. */
export async function moveReturn(repo: WorkspaceRepo, id: string, stageId: string, stageIds: string[], now = new Date()): Promise<ClientReturn> {
  const r = await repo.getReturn(uuid(id, "That return"));
  if (!r || r.archived_at) throw new ValidationError("That return wasn't found.");
  if (!stageIds.includes(stageId)) throw new ValidationError("That stage isn't in the pipeline.");
  return repo.updateReturn(r.id, { stage_id: stageId, ...(stageId === stageIds[stageIds.length - 1] && !r.filed_on ? { filed_on: now.toISOString().slice(0, 10) } : {}) });
}

export async function addTask(repo: WorkspaceRepo, clientId: string, raw: Record<string, unknown>, actorId: string) {
  const id = uuid(clientId, "That client");
  if (!(await repo.getClient(id))) throw new ValidationError("That client wasn't found.");
  const t = checkTask(raw);
  if (t.return_id) {
    const r = await repo.getReturn(uuid(t.return_id, "That return"));
    if (!r || r.client_id !== id) throw new ValidationError("That return isn't this client's.");
  }
  return repo.insertTask({ client_id: id, ...t, created_by: actorId });
}

export async function setTaskDone(repo: WorkspaceRepo, taskId: string, done: boolean, now = new Date()) {
  return repo.updateTask(uuid(taskId, "That task"), { done_at: done ? now.toISOString() : null });
}

export async function addNote(repo: WorkspaceRepo, clientId: string, body: unknown, actorId: string) {
  const id = uuid(clientId, "That client");
  if (!(await repo.getClient(id))) throw new ValidationError("That client wasn't found.");
  const text = clean(body, 4000);
  if (!text) throw new ValidationError("Write the note.");
  return repo.insertNote({ client_id: id, body: text, created_by: actorId });
}

export async function logMessage(repo: WorkspaceRepo, clientId: string, raw: Record<string, unknown>, actorId: string, now = new Date()) {
  const id = uuid(clientId, "That client");
  if (!(await repo.getClient(id))) throw new ValidationError("That client wasn't found.");
  const body = clean(raw.body, 4000);
  if (!body) throw new ValidationError("Write what was said.");
  const channel = (["email", "sms", "call", "other"] as const).find((c) => c === raw.channel) ?? "other";
  const direction = raw.direction === "in" ? "in" : "out";
  const when = typeof raw.occurred_at === "string" && isDay(raw.occurred_at) ? new Date(`${raw.occurred_at}T17:00:00Z`).toISOString() : now.toISOString();
  return repo.insertMessage({ client_id: id, direction, channel, subject: clean(raw.subject, 200) || null, body, occurred_at: when, created_by: actorId });
}

// ---------------------------------------------------------------- invoices

export async function createInvoice(repo: WorkspaceRepo, raw: Record<string, unknown>, actorId: string, now = new Date()): Promise<Invoice> {
  const clientId = uuid(raw.client_id, "That client");
  if (!(await repo.getClient(clientId))) throw new ValidationError("That client wasn't found.");
  const taxYear = Number(clean(raw.tax_year, 4));
  if (!Number.isInteger(taxYear) || taxYear < 2000 || taxYear > now.getUTCFullYear() + 1) throw new ValidationError("Enter a tax year.");
  let returnId: string | null = null;
  if (clean(raw.return_id, 40)) {
    const r = await repo.getReturn(uuid(raw.return_id, "That return"));
    if (!r || r.client_id !== clientId) throw new ValidationError("That return isn't this client's.");
    returnId = r.id;
  }
  const hasLines = Object.keys(raw).some((k) => k.startsWith("line_label_"));
  const lines = hasLines ? checkLines(raw) : defaultInvoiceLines();
  const status: InvoiceStatus = raw.status === "sent" ? "sent" : "draft";
  const issued = typeof raw.issued_on === "string" && isDay(raw.issued_on) ? raw.issued_on : now.toISOString().slice(0, 10);
  const due = typeof raw.due_on === "string" && raw.due_on ? (isDay(raw.due_on) ? raw.due_on : (() => { throw new ValidationError("The due date isn't a valid date."); })()) : null;
  const number = await repo.nextInvoiceNumber();
  return repo.insertInvoice({ client_id: clientId, return_id: returnId, number, tax_year: taxYear, status, lines, total_cents: invoiceTotal(lines), issued_on: issued, due_on: due, notes: clean(raw.notes, 1000) || null, created_by: actorId });
}

export async function sendInvoice(repo: WorkspaceRepo, id: string): Promise<Invoice> {
  const i = await repo.getInvoice(uuid(id, "That invoice"));
  if (!i) throw new ValidationError("That invoice wasn't found.");
  if (i.status !== "draft") throw new ValidationError("Only a draft invoice can be marked sent.");
  return repo.updateInvoice(i.id, { status: "sent" });
}

export async function voidInvoice(repo: WorkspaceRepo, id: string): Promise<Invoice> {
  const i = await repo.getInvoice(uuid(id, "That invoice"));
  if (!i) throw new ValidationError("That invoice wasn't found.");
  if (i.paid_cents > 0) throw new ValidationError("This invoice has a payment on it, so it can't be voided.");
  return repo.updateInvoice(i.id, { status: "void" });
}

/** Records a payment by hand (cash, check, or anything not in a bank import). Pays the invoice off when it covers the balance. */
export async function recordPayment(repo: WorkspaceRepo, id: string, rawAmount: unknown, rawDate: unknown, now = new Date()): Promise<Invoice> {
  const i = await repo.getInvoice(uuid(id, "That invoice"));
  if (!i) throw new ValidationError("That invoice wasn't found.");
  if (i.status === "void") throw new ValidationError("This invoice is void.");
  const cents = parseMoney(typeof rawAmount === "string" ? rawAmount : "");
  if (cents === null || cents === 0) throw new ValidationError("Enter the amount received, like 223 or 223.00.");
  return applyToInvoice(repo, i, cents, typeof rawDate === "string" && isDay(rawDate) ? rawDate : now.toISOString().slice(0, 10));
}

async function applyToInvoice(repo: WorkspaceRepo, i: Invoice, cents: number, paidOn: string): Promise<Invoice> {
  const paid = Math.min(i.total_cents, i.paid_cents + cents);
  const done = paid >= i.total_cents;
  return repo.updateInvoice(i.id, { paid_cents: paid, status: done ? "paid" : i.status === "draft" ? "sent" : i.status, paid_on: done ? paidOn : i.paid_on });
}

// ---------------------------------------------------------------- bank statement import

export type StartedImport = { import: PaymentImport; rows: PaymentRow[]; skipped: number; duplicateOf: PaymentImport | null };

/** Reads an uploaded bank CSV into a review: every deposit, read and matched, with nothing applied. */
export async function startImport(repo: WorkspaceRepo, fileName: string, csv: string, actorId: string, now = new Date()): Promise<StartedImport> {
  const { lines, skipped } = readBankCsv(csv);
  const sha = createHash("sha256").update(csv).digest("hex");
  const duplicateOf = await repo.findImportByHash(sha);
  const [invoices, clients] = await Promise.all([repo.listInvoices(), repo.listClients({ includeArchived: true })]);
  const imp = await repo.insertImport({ file_name: clean(fileName, 200) || "bank-statement.csv", file_sha256: sha, row_count: lines.length, created_by: actorId });
  const rows = await repo.insertImportRows(planImport(imp.id, lines, invoices, new Map(clients.map((c) => [c.id, c])), now));
  return { import: imp, rows, skipped, duplicateOf };
}

export type RowEdit = { rowId: string; invoiceId: string | null; amount: string; ignore: boolean };

/** Saves the user's edits to the review: which invoice a deposit goes to, the amount to apply, or ignoring it. */
export async function saveReview(repo: WorkspaceRepo, importId: string, edits: RowEdit[]): Promise<void> {
  const imp = await repo.getImport(uuid(importId, "That import"));
  if (!imp) throw new ValidationError("That import wasn't found.");
  if (imp.status !== "review") throw new ValidationError("This import is already finished.");
  const rows = new Map((await repo.listImportRows(imp.id)).map((r) => [r.id, r]));
  for (const e of edits) {
    const row = rows.get(e.rowId);
    if (!row || row.status === "applied") continue;
    if (e.ignore) { await repo.updateImportRow(row.id, { status: "ignored" }); continue; }
    const cents = parseMoney(e.amount);
    if (cents === null || cents === 0) throw new ValidationError(`Row ${row.row_no}: enter the amount to apply, like 223.00.`);
    let invoiceId: string | null = null;
    if (e.invoiceId) {
      const inv = await repo.getInvoice(uuid(e.invoiceId, "That invoice"));
      if (!inv) throw new ValidationError(`Row ${row.row_no}: that invoice wasn't found.`);
      invoiceId = inv.id;
    }
    const changed = invoiceId !== row.invoice_id;
    await repo.updateImportRow(row.id, { invoice_id: invoiceId, amount_cents: cents, status: "pending", match: changed ? (invoiceId ? "manual" : "none") : row.match });
  }
}

/** Applies the chosen deposits to their invoices. Only rows the user selected are touched, each at most once. */
export async function applyImport(repo: WorkspaceRepo, importId: string, rowIds: string[], now = new Date()): Promise<{ applied: number; overpaid: number }> {
  const imp = await repo.getImport(uuid(importId, "That import"));
  if (!imp) throw new ValidationError("That import wasn't found.");
  if (imp.status !== "review") throw new ValidationError("This import is already finished.");
  const wanted = new Set(rowIds);
  let applied = 0;
  let overpaid = 0;
  for (const row of await repo.listImportRows(imp.id)) {
    if (!wanted.has(row.id) || row.status !== "pending") continue;
    if (!row.invoice_id) throw new ValidationError(`Row ${row.row_no}: choose an invoice for it, or leave it unticked.`);
    const inv = await repo.getInvoice(row.invoice_id);
    if (!inv || inv.status === "void") throw new ValidationError(`Row ${row.row_no}: that invoice can't take a payment.`);
    if (row.amount_cents > balance(inv)) overpaid++;
    await applyToInvoice(repo, inv, row.amount_cents, row.posted_on ?? now.toISOString().slice(0, 10));
    await repo.updateImportRow(row.id, { status: "applied" });
    applied++;
  }
  const left = (await repo.listImportRows(imp.id)).filter((r) => r.status === "pending").length;
  if (left === 0) await repo.updateImport(imp.id, { status: "applied", applied_at: now.toISOString() });
  return { applied, overpaid };
}

export async function discardImport(repo: WorkspaceRepo, importId: string): Promise<void> {
  const imp = await repo.getImport(uuid(importId, "That import"));
  if (!imp) throw new ValidationError("That import wasn't found.");
  if (imp.status === "applied") throw new ValidationError("Payments from this import were already applied.");
  await repo.updateImport(imp.id, { status: "discarded" });
}

// ---------------------------------------------------------------- household: spouse, dependents, businesses

/** Links two clients as spouses, on both records. Each can have only one spouse. */
export async function linkSpouse(repo: WorkspaceRepo, id: string, spouseId: string): Promise<void> {
  const a = await repo.getClient(uuid(id, "That client"));
  const b = await repo.getClient(uuid(spouseId, "The spouse"));
  if (!a || !b) throw new ValidationError("That client wasn't found.");
  if (a.id === b.id) throw new ValidationError("A client can't be their own spouse.");
  if (a.spouse_id && a.spouse_id !== b.id) throw new ValidationError(`${a.full_name} is already linked to another spouse. Unlink them first.`);
  if (b.spouse_id && b.spouse_id !== a.id) throw new ValidationError(`${b.full_name} is already linked to another spouse. Unlink them first.`);
  await repo.updateClient(a.id, { spouse_id: b.id });
  await repo.updateClient(b.id, { spouse_id: a.id });
}

/** Removes the link on both records. */
export async function unlinkSpouse(repo: WorkspaceRepo, id: string): Promise<void> {
  const a = await repo.getClient(uuid(id, "That client"));
  if (!a) throw new ValidationError("That client wasn't found.");
  if (!a.spouse_id) return;
  const b = await repo.getClient(a.spouse_id);
  await repo.updateClient(a.id, { spouse_id: null });
  if (b && b.spouse_id === a.id) await repo.updateClient(b.id, { spouse_id: null });
}

export async function addDependent(repo: WorkspaceRepo, raw: Record<string, unknown>, actorId: string) {
  const clientId = uuid(raw.client_id, "That client");
  if (!(await repo.getClient(clientId))) throw new ValidationError("That client wasn't found.");
  return repo.insertDependent({ client_id: clientId, ...checkDependent(raw), created_by: actorId });
}

export async function addBusiness(repo: WorkspaceRepo, raw: Record<string, unknown>, actorId: string) {
  const clientId = uuid(raw.client_id, "That client");
  if (!(await repo.getClient(clientId))) throw new ValidationError("That client wasn't found.");
  return repo.insertBusiness({ client_id: clientId, ...checkBusiness(raw), created_by: actorId });
}
