import { createHash } from "node:crypto";
import { ValidationError } from "../commerce/validation.ts";
import { dollars, parseMoney } from "../fees/engine.ts";
import { parseTags, TAG_MAX } from "../leads/tags.ts";
import { changedFields, type FieldChange } from "./activity.ts";
import { balance, checkBillingSettings, checkBusiness, checkClient, checkFeeProduct, checkWork, taxOn, checkDependent, checkLines, checkSpouse, checkReturn, checkTask, formatResult, parseSignedMoney, defaultInvoiceLines, invoiceTotal, isDay, planImport, readBankCsv } from "./rules.ts";
import { checkPlan, type Installment } from "./plan.ts";
import { RECEIPT_METHODS, type InvoiceReceipt, type ReceiptMethod } from "./types.ts";
import { EFILE_STATUSES, FILING_STATUSES, FORM_TYPES, PREP_STATUSES, STATE_FILING_STATUSES, type EfileStatus, type FilingStatus, type FormType, type PrepStatus, type ReturnDetails, type StateFilingStatus } from "./types.ts";
import type { BillingSettings, ClientWork, FeeProduct, Payer, Client, ClientReturn, Invoice, InvoiceLine, InvoiceStatus, PaymentImport, PaymentRow, WorkspaceRepo } from "./types.ts";

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
/** Who did something, for the record on a client's card. */
export type Actor = { id: string | null; email?: string | null };

/** Writes one line to the client's activity record. A failure here is logged but never undoes what the person just did. */
async function record(repo: WorkspaceRepo, clientId: string, actor: Actor | string | null, action: string, detail: Record<string, unknown> = {}) {
  const who: Actor = typeof actor === "string" || actor === null ? { id: actor } : actor;
  try {
    await repo.addClientEvent({ clientId, action, actorId: who.id, detail: who.email ? { ...detail, by: who.email } : detail });
  } catch (e) {
    console.error(`workspace: could not record ${action}: ${e instanceof Error ? e.message : "unknown error"}`);
  }
}

export async function addClient(repo: WorkspaceRepo, raw: Record<string, unknown>, actorId: string, organizationId: string | null = null, actor?: Actor): Promise<Client> {
  const c = await repo.insertClient({ ...checkClient(raw), created_by: actorId, owner_id: actorId, organization_id: organizationId });
  await record(repo, c.id, actor ?? actorId, "client.created");
  return c;
}

/** Saves a client's details and says what changed, so the person can be told and the change can be recorded. */
export async function saveClientWithChanges(repo: WorkspaceRepo, id: string, raw: Record<string, unknown>, actor?: Actor): Promise<{ client: Client; changes: FieldChange[] }> {
  const before = await repo.getClient(uuid(id, "That client"));
  if (!before) throw new ValidationError("That client wasn't found.");
  const client = await repo.updateClient(id, checkClient(raw));
  const changes = changedFields(before, client);
  if (changes.length) await record(repo, id, actor ?? null, "client.updated", { changes });
  return { client, changes };
}

/** Assigns a client to a teammate (their "owner"), or to no one. The person must already be on the team (checked by the caller). */
export async function assignClient(repo: WorkspaceRepo, id: string, assignee: { id: string; label: string } | null, actor?: Actor): Promise<Client> {
  const before = await repo.getClient(uuid(id, "That client"));
  if (!before) throw new ValidationError("That client wasn't found.");
  if ((before.owner_id ?? null) === (assignee?.id ?? null)) return before;
  const client = await repo.updateClient(id, { owner_id: assignee?.id ?? null });
  await record(repo, id, actor ?? null, "client.assigned", { name: assignee?.label ?? "No one" });
  return client;
}

/** Replaces a contact's tags. Returns the tags as saved and what was added or removed, for automations and the activity record. */
export async function saveClientTags(repo: WorkspaceRepo, id: string, raw: unknown, actor?: Actor): Promise<{ before: string[]; after: string[] }> {
  const before = await repo.getClient(uuid(id, "That client"));
  if (!before) throw new ValidationError("That client wasn't found.");
  const prior = parseTags(before.tags ?? []);
  const after = parseTags(raw);
  if (after.length > TAG_MAX) throw new ValidationError(`A contact can have up to ${TAG_MAX} tags.`);
  if (after.length === prior.length && after.every((x) => prior.includes(x))) return { before: prior, after: prior };
  await repo.updateClient(id, { tags: after });
  const added = after.filter((t) => !prior.includes(t));
  const removed = prior.filter((t) => !after.includes(t));
  await record(repo, id, actor ?? null, "client.tags_changed", { name: [...added.map((t) => `added ${t}`), ...removed.map((t) => `removed ${t}`)].join(", ") });
  return { before: prior, after };
}

export async function saveClient(repo: WorkspaceRepo, id: string, raw: Record<string, unknown>, actor?: Actor): Promise<Client> {
  return (await saveClientWithChanges(repo, id, raw, actor)).client;
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

/** Preparation statuses a person can set by hand. "Handed to ERO" is set by the hand-off itself, so it is never picked here. */
export const EDITABLE_PREP: PrepStatus[] = ["not_started", "in_prep", "ready_for_review"];
const returnLabelOf = (r: Pick<ClientReturn, "tax_year" | "kind">) => `${r.tax_year} ${r.kind === "original" ? "return" : r.kind}`;
const isoDay = (v: unknown, label: string): string | null => {
  const t = typeof v === "string" ? v.trim() : "";
  if (!t) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || Number.isNaN(Date.parse(`${t}T12:00:00Z`))) throw new ValidationError(`${label} isn't a valid date.`);
  return t;
};

/**
 * Edits a return: stage, who prepares it, where preparation stands, due and filed dates, and notes. Only what changed is
 * saved, and it is written to the client's activity. The caller has already checked that the preparer is on the team.
 */
export async function editReturn(
  repo: WorkspaceRepo, id: string, raw: Record<string, unknown>, stageIds: string[], stageName: (id: string) => string,
  who: { assignee: (id: string | null) => string }, actor?: Actor, now = new Date(),
): Promise<{ ret: ClientReturn; changes: string[] }> {
  const before = await repo.getReturn(uuid(id, "That return"));
  if (!before || before.archived_at) throw new ValidationError("That return wasn't found.");
  const patch: Partial<Pick<ClientReturn, "stage_id" | "due_on" | "filed_on" | "notes" | "assignee_id" | "prep_status">> & ReturnDetails = {};
  const changes: string[] = [];
  const stage = typeof raw.stage_id === "string" && raw.stage_id ? raw.stage_id : before.stage_id;
  if (!stageIds.includes(stage)) throw new ValidationError("That stage isn't in the pipeline.");
  if (stage !== before.stage_id) { patch.stage_id = stage; changes.push(`Stage from ${stageName(before.stage_id)} to ${stageName(stage)}`); }
  const due = isoDay(raw.due_on, "The due date");
  if (due !== before.due_on) { patch.due_on = due; changes.push(`Due date from ${before.due_on ?? "blank"} to ${due ?? "blank"}`); }
  let filed = isoDay(raw.filed_on, "The filed date");
  // Moving a return to the last stage fills in today's date as filed, as dragging it on the board does.
  if (patch.stage_id === stageIds[stageIds.length - 1] && !filed && !before.filed_on) filed = now.toISOString().slice(0, 10);
  if (filed !== before.filed_on) { patch.filed_on = filed; changes.push(`Filed date from ${before.filed_on ?? "blank"} to ${filed ?? "blank"}`); }
  const prep = typeof raw.prep_status === "string" && raw.prep_status ? (raw.prep_status as PrepStatus) : before.prep_status;
  if (prep !== before.prep_status) {
    if (!EDITABLE_PREP.includes(prep) || before.prep_status === "handed_off") throw new ValidationError("A return handed to an ERO is changed by the hand-off, not here.");
    patch.prep_status = prep;
    changes.push(`Preparation from ${PREP_STATUSES[before.prep_status]} to ${PREP_STATUSES[prep]}`);
  }
  const assignee = typeof raw.assignee_id === "string" && raw.assignee_id ? raw.assignee_id : null;
  if (assignee !== (before.assignee_id ?? null)) { patch.assignee_id = assignee; changes.push(`Preparer from ${who.assignee(before.assignee_id)} to ${who.assignee(assignee)}`); }
  const notes = typeof raw.notes === "string" ? raw.notes.replace(/\r\n/g, "\n").trim().slice(0, 2000) : "";
  if ((notes || null) !== (before.notes ?? null)) { patch.notes = notes || null; changes.push("Notes edited"); }
  // The details an office tracks. A field the form didn't send is left alone.
  const details: ReturnDetails = {};
  const pick = <T extends string>(key: string, allowed: Record<string, string>, current: T | null | undefined, label: string, set: (v: T | null) => void) => {
    if (!(key in raw)) return;
    const v = typeof raw[key] === "string" && raw[key] ? (raw[key] as T) : null;
    if (v !== null && !(v in allowed)) throw new ValidationError(`${label} isn't one of the choices.`);
    if (v !== (current ?? null)) { set(v); changes.push(`${label} from ${current ? allowed[current] : "blank"} to ${v ? allowed[v] : "blank"}`); }
  };
  pick<FormType>("form_type", FORM_TYPES, before.form_type, "Form", (v) => { details.form_type = v; });
  pick<FilingStatus>("filing_status", FILING_STATUSES, before.filing_status, "Filing status", (v) => { details.filing_status = v; });
  const efile = typeof raw.efile_status === "string" && raw.efile_status ? (raw.efile_status as EfileStatus) : (before.efile_status ?? "not_sent");
  if (!(efile in EFILE_STATUSES)) throw new ValidationError("E-file status isn't one of the choices.");
  if (efile !== (before.efile_status ?? "not_sent")) {
    details.efile_status = efile;
    changes.push(`E-file from ${EFILE_STATUSES[before.efile_status ?? "not_sent"]} to ${EFILE_STATUSES[efile]}`);
    // A new e-file status without a date is dated today.
    if (!("efile_on" in raw) || !raw.efile_on) details.efile_on = efile === "not_sent" ? null : now.toISOString().slice(0, 10);
  }
  if ("efile_on" in raw && raw.efile_on) { const d = isoDay(raw.efile_on, "The e-file date"); if (d !== (before.efile_on ?? null)) { details.efile_on = d; if (!changes.some((c) => c.startsWith("E-file"))) changes.push(`E-file date to ${d}`); } }
  if ("efile_reject_reason" in raw) {
    const reason = typeof raw.efile_reject_reason === "string" ? raw.efile_reject_reason.replace(/\s+/g, " ").trim().slice(0, 500) : "";
    if ((reason || null) !== (before.efile_reject_reason ?? null)) { details.efile_reject_reason = reason || null; changes.push("Rejection reason edited"); }
  }
  const money = (key: string, label: string, set: (c: number | null) => void, current: number | null | undefined) => {
    if (!(key in raw)) return;
    const t = typeof raw[key] === "string" ? (raw[key] as string).trim() : "";
    const cents = t ? parseMoney(t) : null;
    if (t && cents === null) throw new ValidationError(`${label} isn't a valid amount.`);
    if (cents !== (current ?? null)) { set(cents); changes.push(`${label} from ${current != null ? dollars(current) : "blank"} to ${cents != null ? dollars(cents) : "blank"}`); }
  };
  money("fee", "Fee amount", (c) => { details.fee_cents = c; }, before.fee_cents);
  if ("federal_result" in raw) {
    const cents = parseSignedMoney(raw.federal_result);
    if (cents !== (before.federal_result_cents ?? null)) { details.federal_result_cents = cents; changes.push(`Federal result from ${before.federal_result_cents == null ? "blank" : formatResult(before.federal_result_cents)} to ${cents == null ? "blank" : formatResult(cents)}`); }
  }
  if (!changes.length) return { ret: before, changes };
  Object.assign(patch, details);
  const ret = await repo.updateReturn(before.id, patch);
  await record(repo, before.client_id, actor ?? null, "return.updated", { return_id: before.id, label: returnLabelOf(before), changes });
  return { ret, changes };
}

/** Archives a return added by mistake. Its history stays in the client's activity. */
export async function archiveReturn(repo: WorkspaceRepo, id: string, actor?: Actor): Promise<ClientReturn> {
  const r = await repo.getReturn(uuid(id, "That return"));
  if (!r || r.archived_at) throw new ValidationError("That return wasn't found.");
  const ret = await repo.updateReturn(r.id, { archived_at: new Date().toISOString() });
  await record(repo, r.client_id, actor ?? null, "return.archived", { return_id: r.id, label: returnLabelOf(r) });
  return ret;
}

/** Starts a piece of work (planning, bookkeeping, payroll...) for a client in one of the office's pipelines, in its first stage. */
export async function addWork(repo: WorkspaceRepo, raw: Record<string, unknown>, pipeline: { id: string; stages: { id: string }[] }, actorId: string): Promise<ClientWork> {
  const w = checkWork(raw);
  const client = await repo.getClient(uuid(w.client_id, "That client"));
  if (!client || client.archived_at) throw new ValidationError("That client wasn't found.");
  if (!pipeline.stages.length) throw new ValidationError("That pipeline has no stages yet.");
  return repo.insertWork({ ...w, client_id: client.id, pipeline_id: pipeline.id, stage_id: pipeline.stages[0].id, created_by: actorId });
}

export async function moveWork(repo: WorkspaceRepo, id: string, stageId: string, stageIds: string[]): Promise<ClientWork> {
  const w = await repo.getWork(uuid(id, "That work"));
  if (!w || w.archived_at) throw new ValidationError("That work wasn't found.");
  if (!stageIds.includes(stageId)) throw new ValidationError("That stage isn't in the pipeline.");
  return repo.updateWork(w.id, { stage_id: stageId });
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
  // The standard fees come from Settings (the tax software and bank product picked), never from the form; the form only chooses
  // whether to include them and adds other charges. With no software or bank product set up, the older standard fees apply.
  const hasLines = Object.keys(raw).some((k) => k.startsWith("line_label_"));
  const chooses = Object.hasOwn(raw, "include_standard");
  // A caller that sends no choice keeps the old rule: its own lines are the invoice, or the standard fees when it sends none.
  const includeStandard = chooses ? raw.include_standard === "yes" : !hasLines;
  const products = await feeProducts(repo);
  const software = includeStandard ? pickProduct(products, "software", raw.software_id) : null;
  const bank = includeStandard ? pickProduct(products, "bank", raw.bank_id) : null;
  const standard = (!includeStandard ? [] : products.length === 0 ? await standardFees(repo) : [...(software?.lines ?? []), ...(bank?.lines ?? [])]).map((l) => ({ label: l.label, amount_cents: l.amount_cents, standard: true }));
  let extra: InvoiceLine[] = [];
  if (hasLines) {
    try { extra = checkLines(raw); } catch (e) { if (!(standard.length && e instanceof ValidationError && /at least one line/.test(e.message))) throw e; }
  }
  const lines = [...standard, ...extra];
  if (!lines.length) throw new ValidationError("An invoice needs at least one line: include the standard fees or add a charge.");
  const settings = await billingSettings(repo);
  const subtotal = invoiceTotal(lines);
  const tax_cents = taxOn(subtotal, settings.tax_percent);
  const payer: Payer = raw.payer === "bank_product" || raw.payer === "self" ? raw.payer : bank ? "bank_product" : "self";
  const status: InvoiceStatus = raw.status === "sent" ? "sent" : "draft";
  const issued = typeof raw.issued_on === "string" && isDay(raw.issued_on) ? raw.issued_on : now.toISOString().slice(0, 10);
  const due = typeof raw.due_on === "string" && raw.due_on ? (isDay(raw.due_on) ? raw.due_on : (() => { throw new ValidationError("The due date isn't a valid date."); })()) : null;
  const number = await repo.nextInvoiceNumber();
  const plan = checkPlan(raw, subtotal + tax_cents);
  const invoice = await repo.insertInvoice({ client_id: clientId, return_id: returnId, number, tax_year: taxYear, status, lines, total_cents: subtotal + tax_cents, tax_percent: settings.tax_percent, tax_cents, payer, software_name: software?.name ?? null, bank_name: bank?.name ?? null, issued_on: issued, due_on: due, notes: clean(raw.notes, 1000) || null, created_by: actorId });
  if (plan) await repo.replaceInstallments(invoice.id, plan);
  return invoice;
}

/** The tax software or bank product named on the form, or the only one of its kind when there is just one. */
function pickProduct(products: FeeProduct[], kind: "software" | "bank", id: unknown): FeeProduct | null {
  const ofKind = products.filter((p) => p.kind === kind);
  if (typeof id === "string" && id) {
    const found = ofKind.find((p) => p.id === id);
    if (!found) throw new ValidationError(`That ${kind === "software" ? "tax software" : "bank product"} wasn't found.`);
    return found;
  }
  return ofKind.length === 1 ? ofKind[0] : null;
}

/** Sets up (or replaces) a payment plan on an invoice nothing has been paid on yet. */
export async function setPaymentPlan(repo: WorkspaceRepo, id: string, raw: Record<string, unknown>): Promise<Installment[]> {
  const i = await repo.getInvoice(uuid(id, "That invoice"));
  if (!i) throw new ValidationError("That invoice wasn't found.");
  if (i.status === "void" || i.status === "paid") throw new ValidationError("This invoice can't have a payment plan.");
  if (i.paid_cents > 0) throw new ValidationError("A payment has already been made on this invoice, so a payment plan can't be set up.");
  const plan = checkPlan(raw, i.total_cents);
  if (!plan) throw new ValidationError("Choose how many payments: 2 or more.");
  await repo.replaceInstallments(i.id, plan);
  return plan;
}

export async function removePaymentPlan(repo: WorkspaceRepo, id: string): Promise<void> {
  const i = await repo.getInvoice(uuid(id, "That invoice"));
  if (!i) throw new ValidationError("That invoice wasn't found.");
  await repo.replaceInstallments(i.id, []);
}

export async function sendInvoice(repo: WorkspaceRepo, id: string): Promise<Invoice> {
  const i = await repo.getInvoice(uuid(id, "That invoice"));
  if (!i) throw new ValidationError("That invoice wasn't found.");
  if (i.status !== "draft") throw new ValidationError("Only a draft invoice can be marked sent.");
  return repo.updateInvoice(i.id, { status: "sent" });
}

/**
 * Changes an unpaid invoice (lines, tax year, due date, notes, who pays), or, once a payment is on it, only its due date, notes
 * and who pays. Sales tax is figured again at the percent the invoice was made with. When the total changes, a payment plan no
 * longer adds up, so it is removed, and the caller is told so.
 */
export async function editInvoice(repo: WorkspaceRepo, id: string, raw: Record<string, unknown>): Promise<{ invoice: Invoice; totalChanged: boolean; planRemoved: boolean }> {
  const i = await repo.getInvoice(uuid(id, "That invoice"));
  if (!i) throw new ValidationError("That invoice wasn't found.");
  if (i.status === "void" || i.status === "paid") throw new ValidationError("A paid or void invoice can't be edited.");
  const due = typeof raw.due_on === "string" && raw.due_on ? (isDay(raw.due_on) ? raw.due_on : (() => { throw new ValidationError("The due date isn't a valid date."); })()) : null;
  const patch: Parameters<WorkspaceRepo["updateInvoice"]>[1] = { due_on: due, notes: clean(raw.notes, 1000) || null };
  if (raw.payer === "bank_product" || raw.payer === "self") patch.payer = raw.payer;
  let totalChanged = false;
  if (i.paid_cents === 0) {
    // The standard fees stay exactly as they were made; only the other charges can change.
    const kept = i.lines.filter((l) => l.standard);
    let extra: InvoiceLine[] = [];
    try { extra = checkLines(raw); } catch (e) { if (!(kept.length && e instanceof ValidationError && /at least one line/.test(e.message))) throw e; }
    const lines = [...kept, ...extra];
    const year = Number(clean(raw.tax_year, 4));
    if (!Number.isInteger(year) || year < 2000 || year > new Date().getUTCFullYear() + 1) throw new ValidationError("Enter a tax year.");
    const subtotal = invoiceTotal(lines);
    const tax = taxOn(subtotal, i.tax_percent ?? 0);
    patch.lines = lines; patch.tax_year = year; patch.tax_cents = tax; patch.total_cents = subtotal + tax;
    totalChanged = subtotal + tax !== i.total_cents;
  }
  const hadPlan = (await repo.listInstallments([i.id])).length > 0;
  const invoice = await repo.updateInvoice(i.id, patch);
  if (totalChanged && hadPlan) await repo.replaceInstallments(i.id, []);
  return { invoice, totalChanged, planRemoved: totalChanged && hadPlan };
}

/** Archives a voided invoice, or brings an archived one back. Only a voided invoice can be archived. */
export async function archiveInvoice(repo: WorkspaceRepo, id: string, archive: boolean): Promise<Invoice> {
  const i = await repo.getInvoice(uuid(id, "That invoice"));
  if (!i) throw new ValidationError("That invoice wasn't found.");
  if (archive && i.status !== "void") throw new ValidationError("Only a voided invoice can be archived. Void it first.");
  return repo.updateInvoice(i.id, { archived_at: archive ? new Date().toISOString() : null });
}

export async function voidInvoice(repo: WorkspaceRepo, id: string): Promise<Invoice> {
  const i = await repo.getInvoice(uuid(id, "That invoice"));
  if (!i) throw new ValidationError("That invoice wasn't found.");
  if (i.paid_cents > 0) throw new ValidationError("This invoice has a payment on it, so it can't be voided.");
  return repo.updateInvoice(i.id, { status: "void" });
}

/** Records a payment by hand (cash, check, or anything not in a bank import). Pays the invoice off when it covers the balance. */
export async function recordPayment(repo: WorkspaceRepo, id: string, rawAmount: unknown, rawDate: unknown, now = new Date(), how: { method?: unknown; reference?: unknown; actorId?: string | null } = {}): Promise<Invoice> {
  const i = await repo.getInvoice(uuid(id, "That invoice"));
  if (!i) throw new ValidationError("That invoice wasn't found.");
  if (i.status === "void") throw new ValidationError("This invoice is void.");
  const cents = parseMoney(typeof rawAmount === "string" ? rawAmount : "");
  if (cents === null || cents === 0) throw new ValidationError("Enter the amount received, like 223 or 223.00.");
  const method = typeof how.method === "string" && Object.hasOwn(RECEIPT_METHODS, how.method) ? (how.method as ReceiptMethod) : i.payer === "bank_product" ? "bank_product" : "other";
  const reference = clean(how.reference, 80) || null;
  return applyToInvoice(repo, i, cents, typeof rawDate === "string" && isDay(rawDate) ? rawDate : now.toISOString().slice(0, 10), { method, reference, source: "manual", actorId: how.actorId ?? null });
}

/** The payments recorded against these invoices (by hand or from a bank statement), newest first. */
export async function receiptsFor(repo: WorkspaceRepo, invoiceIds?: string[]): Promise<InvoiceReceipt[]> {
  return repo.listReceipts(invoiceIds).catch(() => []);
}

async function applyToInvoice(repo: WorkspaceRepo, i: Invoice, cents: number, paidOn: string, how: { method: ReceiptMethod; reference: string | null; source: "manual" | "bank_import"; actorId: string | null }): Promise<Invoice> {
  const paid = Math.min(i.total_cents, i.paid_cents + cents);
  // The line saying how it was paid is kept for what was actually applied, so the lines always add up to what the invoice shows paid.
  const applied = paid - i.paid_cents;
  if (applied > 0) await repo.insertReceipt({ invoice_id: i.id, client_id: i.client_id, amount_cents: applied, method: how.method, reference: how.reference, received_on: paidOn, source: how.source, created_by: how.actorId });
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
    await applyToInvoice(repo, inv, row.amount_cents, row.posted_on ?? now.toISOString().slice(0, 10), { method: "bank_transfer", reference: clean(row.description, 80) || null, source: "bank_import", actorId: null });
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

const fullName = (first: string, last: string | null) => [first, last].filter(Boolean).join(" ");

/** Links two clients as spouses, on both records. Each can have only one spouse. A spouse entered by hand is replaced by the link. */
export async function linkSpouse(repo: WorkspaceRepo, id: string, spouseId: string, actor?: Actor, filedLastYear: boolean | null = null): Promise<void> {
  const a = await repo.getClient(uuid(id, "That client"));
  const b = await repo.getClient(uuid(spouseId, "The spouse"));
  if (!a || !b) throw new ValidationError("That client wasn't found.");
  if (a.id === b.id) throw new ValidationError("A client can't be their own spouse.");
  if (a.spouse_id && a.spouse_id !== b.id) throw new ValidationError(`${a.full_name} is already linked to another spouse. Unlink them first.`);
  if (b.spouse_id && b.spouse_id !== a.id) throw new ValidationError(`${b.full_name} is already linked to another spouse. Unlink them first.`);
  await repo.deleteSpouse(a.id);
  await repo.deleteSpouse(b.id);
  await repo.updateClient(a.id, { spouse_id: b.id, ...(filedLastYear === null ? {} : { filed_with_spouse_last_year: filedLastYear }) });
  await repo.updateClient(b.id, { spouse_id: a.id, ...(filedLastYear === null ? {} : { filed_with_spouse_last_year: filedLastYear }) });
  await record(repo, a.id, actor ?? null, "client.spouse_linked", { name: b.full_name });
  await record(repo, b.id, actor ?? null, "client.spouse_linked", { name: a.full_name });
}

/** Removes the link on both records. */
export async function unlinkSpouse(repo: WorkspaceRepo, id: string, actor?: Actor): Promise<void> {
  const a = await repo.getClient(uuid(id, "That client"));
  if (!a) throw new ValidationError("That client wasn't found.");
  if (!a.spouse_id) return;
  const b = await repo.getClient(a.spouse_id);
  await repo.updateClient(a.id, { spouse_id: null });
  if (b && b.spouse_id === a.id) await repo.updateClient(b.id, { spouse_id: null });
  await record(repo, a.id, actor ?? null, "client.spouse_unlinked", { name: b?.full_name ?? "" });
}

/** Saves a spouse typed in by hand (one who isn't a client). Replaces the one entered before. */
export async function saveSpouse(repo: WorkspaceRepo, raw: Record<string, unknown>, actor?: Actor) {
  const clientId = uuid(raw.client_id, "That client");
  const c = await repo.getClient(clientId);
  if (!c) throw new ValidationError("That client wasn't found.");
  if (c.spouse_id) throw new ValidationError("This client is linked to a spouse who is also a client. Unlink them to enter a spouse by hand.");
  const input = checkSpouse(raw);
  const { filed_last_year: filed, ...fields } = input;
  const s = await repo.upsertSpouse({ client_id: clientId, ...fields, created_by: actor?.id ?? null });
  if (filed !== null) await repo.updateClient(clientId, { filed_with_spouse_last_year: filed });
  await record(repo, clientId, actor ?? null, "client.spouse_saved", { name: fullName(input.first_name, input.last_name) });
  return s;
}

export async function removeSpouse(repo: WorkspaceRepo, clientId: string, actor?: Actor): Promise<void> {
  const id = uuid(clientId, "That client");
  const s = await repo.getSpouse(id);
  if (!s) return;
  await repo.deleteSpouse(id);
  await record(repo, id, actor ?? null, "client.spouse_removed", { name: fullName(s.first_name, s.last_name) });
}

export async function addDependent(repo: WorkspaceRepo, raw: Record<string, unknown>, actorId: string, actor?: Actor) {
  const clientId = uuid(raw.client_id, "That client");
  if (!(await repo.getClient(clientId))) throw new ValidationError("That client wasn't found.");
  const input = checkDependent(raw);
  const d = await repo.insertDependent({ client_id: clientId, ...input, created_by: actorId });
  await record(repo, clientId, actor ?? actorId, "client.dependent_added", { name: fullName(input.first_name, input.last_name) });
  return d;
}

export async function removeDependent(repo: WorkspaceRepo, clientId: string, id: string, actor?: Actor): Promise<void> {
  const cid = uuid(clientId, "That client");
  const d = (await repo.listDependents(cid)).find((x) => x.id === id);
  if (!d) throw new ValidationError("That dependent wasn't found.");
  await repo.deleteDependent(d.id);
  await record(repo, cid, actor ?? null, "client.dependent_removed", { name: fullName(d.first_name, d.last_name) });
}

export async function addBusiness(repo: WorkspaceRepo, raw: Record<string, unknown>, actorId: string, actor?: Actor) {
  const clientId = uuid(raw.client_id, "That client");
  if (!(await repo.getClient(clientId))) throw new ValidationError("That client wasn't found.");
  const input = checkBusiness(raw);
  const b = await repo.insertBusiness({ client_id: clientId, ...input, created_by: actorId });
  await record(repo, clientId, actor ?? actorId, "client.business_added", { name: input.name });
  return b;
}

export async function removeBusiness(repo: WorkspaceRepo, clientId: string, id: string, actor?: Actor): Promise<void> {
  const cid = uuid(clientId, "That client");
  const b = (await repo.listBusinesses(cid)).find((x) => x.id === id);
  if (!b) throw new ValidationError("That business wasn't found.");
  await repo.deleteBusiness(b.id);
  await record(repo, cid, actor ?? null, "client.business_removed", { name: b.name });
}

// ---------------------------------------------------------------- standard invoice fees and merging duplicates

/** The standard fee lines an invoice starts from: the office's own, or the $223 breakdown until it saves its own. */
export async function standardFees(repo: WorkspaceRepo): Promise<InvoiceLine[]> {
  return (await repo.getInvoiceDefaults().catch(() => null)) ?? defaultInvoiceLines();
}

export async function billingSettings(repo: WorkspaceRepo): Promise<BillingSettings> {
  return (await repo.getBillingSettings().catch(() => null)) ?? { refund_policy: null, terms: null, tax_percent: 0 };
}

export async function saveBillingSettings(repo: WorkspaceRepo, raw: Record<string, unknown>, actorId: string): Promise<BillingSettings> {
  const s = checkBillingSettings(raw);
  await repo.saveBillingSettings(s, actorId);
  return s;
}

/** The tax software and bank products set up in Settings (not archived). */
export async function feeProducts(repo: WorkspaceRepo): Promise<FeeProduct[]> {
  return repo.listFeeProducts().catch(() => []);
}

export async function addFeeProduct(repo: WorkspaceRepo, raw: Record<string, unknown>, actorId: string): Promise<FeeProduct> {
  const p = checkFeeProduct(raw);
  if ((await feeProducts(repo)).some((x) => x.kind === p.kind && x.name.toLowerCase() === p.name.toLowerCase())) throw new ValidationError(`You already have one called "${p.name}".`);
  return repo.insertFeeProduct({ ...p, created_by: actorId });
}

export async function saveFeeProduct(repo: WorkspaceRepo, id: string, raw: Record<string, unknown>): Promise<FeeProduct> {
  const current = (await feeProducts(repo)).find((x) => x.id === uuid(id, "That item"));
  if (!current) throw new ValidationError("That wasn't found.");
  const p = checkFeeProduct({ ...raw, kind: current.kind });
  return repo.updateFeeProduct(current.id, { name: p.name, lines: p.lines });
}

/** Removes a product from the pick lists. Invoices already made keep the name and fees they were made with. */
export async function archiveFeeProduct(repo: WorkspaceRepo, id: string): Promise<void> {
  const current = (await feeProducts(repo)).find((x) => x.id === uuid(id, "That item"));
  if (!current) throw new ValidationError("That wasn't found.");
  await repo.updateFeeProduct(current.id, { archived_at: new Date().toISOString() });
}

/** Moves everything on `drop` onto `keep` and archives `drop`. Both must be clients of this workspace. */
export async function mergeClients(repo: WorkspaceRepo, keepId: string, dropId: string, actor?: Actor): Promise<Record<string, number>> {
  const keep = await repo.getClient(uuid(keepId, "The client to keep"));
  const drop = await repo.getClient(uuid(dropId, "The client to merge"));
  if (!keep || !drop) throw new ValidationError("That client wasn't found.");
  if (keep.id === drop.id) throw new ValidationError("Choose two different clients.");
  if (keep.archived_at) throw new ValidationError("The client to keep is archived. Restore them first.");
  const moved = await repo.mergeClients(keep.id, drop.id, actor?.id ?? null);
  // The merge fills only what the kept client was missing. Anything that differs is written into a note, and tags and the owner carry over.
  try {
    const digits = (v: string | null) => (v ?? "").replace(/\D+/g, "");
    const left: string[] = [];
    if (drop.full_name.trim().toLowerCase() !== keep.full_name.trim().toLowerCase()) left.push(`Name: ${drop.full_name}`);
    if (drop.email && drop.email.toLowerCase() !== (keep.email ?? "").toLowerCase() && keep.email) left.push(`Other email: ${drop.email}`);
    if (drop.phone && keep.phone && digits(drop.phone) !== digits(keep.phone)) left.push(`Other phone: ${drop.phone}`);
    const addr = (c: typeof keep) => [c.address_line1 ?? c.address, c.city, c.state, c.zip].filter(Boolean).join(", ");
    if (addr(drop) && addr(keep) && addr(drop).toLowerCase() !== addr(keep).toLowerCase()) left.push(`Other address: ${addr(drop)}`);
    if (left.length) await repo.insertNote({ client_id: keep.id, body: `Merged from ${drop.full_name}. Details that differed:\n${left.join("\n")}`.slice(0, 4000), created_by: actor?.id ?? null });
    const tags = [...new Set([...(keep.tags ?? []), ...(drop.tags ?? [])])].sort();
    const patch: { tags?: string[]; owner_id?: string | null } = {};
    if (tags.length > (keep.tags ?? []).length) patch.tags = tags;
    if (!keep.owner_id && drop.owner_id) patch.owner_id = drop.owner_id;
    if (patch.tags || "owner_id" in patch) await repo.updateClient(keep.id, patch);
  } catch { /* the merge itself is done and stands */ }
  return moved;
}


/** Adds a state return to a return, or updates its status and filed date. */
export async function saveStateFiling(repo: WorkspaceRepo, returnId: string, raw: { state: unknown; status: unknown; filed_on?: unknown; result?: unknown }, actor?: Actor) {
  const r = await repo.getReturn(uuid(returnId, "That return"));
  if (!r || r.archived_at) throw new ValidationError("That return wasn't found.");
  const state = typeof raw.state === "string" ? raw.state.trim().toUpperCase() : "";
  if (!/^[A-Z]{2}$/.test(state)) throw new ValidationError("Enter the state as two letters, like LA.");
  const status = (typeof raw.status === "string" && raw.status ? raw.status : "not_started") as StateFilingStatus;
  if (!(status in STATE_FILING_STATUSES)) throw new ValidationError("Choose a status for the state return.");
  const filedOn = isoDay(raw.filed_on, "The filed date");
  const resultCents = parseSignedMoney(raw.result);
  const saved = await repo.saveStateFiling(r.id, state, status, filedOn, resultCents);
  await record(repo, r.client_id, actor ?? null, "return.updated", { return_id: r.id, label: returnLabelOf(r), changes: [`${state} state return: ${STATE_FILING_STATUSES[status]}${resultCents != null ? `, ${formatResult(resultCents)}` : ""}`] });
  return saved;
}

export async function removeStateFiling(repo: WorkspaceRepo, returnId: string, filingId: string, actor?: Actor): Promise<void> {
  const r = await repo.getReturn(uuid(returnId, "That return"));
  const filing = r ? (await repo.listStateFilings(r.id)).find((x) => x.id === filingId) : null;
  if (!r || !filing) throw new ValidationError("That state return wasn't found.");
  await repo.removeStateFiling(filing.id);
  await record(repo, r.client_id, actor ?? null, "return.updated", { return_id: r.id, label: returnLabelOf(r), changes: [`${filing.state} state return removed`] });
}
