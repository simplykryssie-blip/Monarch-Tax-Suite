import { isEmailAddress, type EmailSender } from "../automation/email.ts";
import type { ResolvedSender } from "../automation/senders.ts";
import { sanitizeError } from "../automation/sanitize.ts";
import { ValidationError } from "../commerce/validation.ts";
import { addClient, addReturn, saveClient } from "../workspace/service.ts";
import type { Client, ClientDoc, ClientReturn, PrepStatus } from "../workspace/types.ts";
import { handoffCsv, handoffFileName, sha256 } from "./export.ts";
import type { ChecklistItem, Handoff, PrepDeps, Scope } from "./types.ts";

// The return-prep and assignment layer. Every function takes the caller's scope and refuses what it doesn't cover with
// the same "wasn't found" a missing row gets, so nobody can tell another person's work exists. The database keeps the
// tenants apart; this layer keeps people within a tenant (or an office) to their own clients and returns.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const nowOf = (d: PrepDeps) => (d.now ? d.now() : new Date());
const notFound = (what: string): never => { throw new ValidationError(`${what} wasn't found.`); };
const line = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");

/** A neutral starting checklist; a tenant adds or removes items on each return. */
export const DEFAULT_CHECKLIST = [
  "Photo ID received", "Prior-year return received", "Income documents received (W-2, 1099)", "Deduction and credit documents received", "Engagement or consent signed", "Refund or payment details confirmed",
] as const;

// ---------------------------------------------------------------- who sees what

const sameOffice = (scope: Scope, row: { organization_id: string | null }) => (row.organization_id ?? null) === scope.organizationId;
const mayReturn = (scope: Scope, r: ClientReturn, client: Client | null) =>
  sameOffice(scope, r) && (scope.all || r.assignee_id === scope.userId || client?.owner_id === scope.userId);

/** A client is visible to the person who owns them, to anyone holding a return assigned to them, and to a person with `all`. */
async function clientVisible(deps: PrepDeps, scope: Scope, c: Client): Promise<boolean> {
  if (!sameOffice(scope, c)) return false;
  if (scope.all || c.owner_id === scope.userId) return true;
  return (await deps.ws.listReturns({ clientId: c.id, assigneeId: scope.userId })).length > 0;
}

export async function visibleClients(deps: PrepDeps, scope: Scope, q?: string): Promise<Client[]> {
  const org = scope.organizationId ?? undefined;
  const mine = await deps.ws.listClients({ q, ...(scope.all ? {} : { ownerId: scope.userId }), ...(org ? { organizationId: org } : {}) });
  const own = mine.filter((c) => sameOffice(scope, c));
  if (scope.all) return own;
  // Clients owned by someone else whose return is assigned to this person.
  const have = new Set(own.map((c) => c.id));
  const assigned = await deps.ws.listReturns({ assigneeId: scope.userId, ...(org ? { organizationId: org } : {}) });
  const extra: Client[] = [];
  for (const id of new Set(assigned.filter((r) => sameOffice(scope, r)).map((r) => r.client_id))) {
    if (have.has(id)) continue;
    const c = await deps.ws.getClient(id);
    if (c && !c.archived_at && sameOffice(scope, c) && (!q || c.full_name.toLowerCase().includes(q.toLowerCase()))) extra.push(c);
  }
  return [...own, ...extra].sort((a, b) => a.full_name.localeCompare(b.full_name));
}

export async function loadClient(deps: PrepDeps, scope: Scope, id: unknown): Promise<Client> {
  const c = typeof id === "string" && UUID.test(id) ? await deps.ws.getClient(id) : null;
  if (!c || !(await clientVisible(deps, scope, c))) return notFound("That client");
  return c;
}

export async function visibleReturns(deps: PrepDeps, scope: Scope, f: { year?: number; clientId?: string; assignedOnly?: boolean } = {}): Promise<ClientReturn[]> {
  const org = scope.organizationId ?? undefined;
  const rows = await deps.ws.listReturns({ year: f.year, clientId: f.clientId, ...(org ? { organizationId: org } : {}), ...(scope.all && !f.assignedOnly ? {} : f.assignedOnly ? { assigneeId: scope.userId } : {}) });
  const inOffice = rows.filter((r) => sameOffice(scope, r));
  if (scope.all || f.assignedOnly) return inOffice;
  const out: ClientReturn[] = [];
  const owned = new Map<string, Client | null>();
  for (const r of inOffice) {
    if (r.assignee_id === scope.userId) { out.push(r); continue; }
    if (!owned.has(r.client_id)) owned.set(r.client_id, await deps.ws.getClient(r.client_id));
    if (mayReturn(scope, r, owned.get(r.client_id) ?? null)) out.push(r);
  }
  return out;
}

export async function loadReturn(deps: PrepDeps, scope: Scope, id: unknown): Promise<{ ret: ClientReturn; client: Client }> {
  const r = typeof id === "string" && UUID.test(id) ? await deps.ws.getReturn(id) : null;
  const client = r ? await deps.ws.getClient(r.client_id) : null;
  if (!r || r.archived_at || !client || !mayReturn(scope, r, client)) return notFound("That return");
  return { ret: r, client };
}

// ---------------------------------------------------------------- intake

export async function addMyClient(deps: PrepDeps, scope: Scope, raw: Record<string, unknown>): Promise<Client> {
  const c = await addClient(deps.ws, raw, scope.userId, scope.organizationId);
  await deps.audit({ actor_id: scope.userId, action: "client_added", subject_type: "client", subject_id: c.id });
  return c;
}

export async function saveMyClient(deps: PrepDeps, scope: Scope, id: string, raw: Record<string, unknown>): Promise<Client> {
  const c = await loadClient(deps, scope, id);
  const saved = await saveClient(deps.ws, c.id, raw, { id: scope.userId });
  await deps.audit({ actor_id: scope.userId, action: "client_updated", subject_type: "client", subject_id: c.id });
  return saved;
}

// ---------------------------------------------------------------- prep

/** Starts a return for one of the person's clients; it is theirs to work, and gets the intake checklist. */
export async function startReturn(deps: PrepDeps, scope: Scope, raw: Record<string, unknown>, firstStage: string): Promise<ClientReturn> {
  const client = await loadClient(deps, scope, raw.client_id);
  const r = await addReturn(deps.ws, { ...raw, client_id: client.id }, firstStage, nowOf(deps), scope.userId);
  await deps.prep.insertChecklist(r.id, [...DEFAULT_CHECKLIST], 0);
  await deps.audit({ actor_id: scope.userId, action: "return_started", subject_type: "client_return", subject_id: r.id, detail: { tax_year: r.tax_year, kind: r.kind } });
  return r;
}

const NEXT: Record<PrepStatus, PrepStatus[]> = { not_started: ["in_prep"], in_prep: ["ready_for_review"], ready_for_review: ["in_prep"], handed_off: [] };

/** Moves a return through preparation. "Handed to ERO" is reached only by handing it over (handOff). */
export async function setPrepStatus(deps: PrepDeps, scope: Scope, returnId: string, next: PrepStatus): Promise<ClientReturn> {
  const { ret } = await loadReturn(deps, scope, returnId);
  if (ret.prep_status === next) return ret;
  if (ret.prep_status === "handed_off") throw new ValidationError("This return was handed to an ERO and can't be changed here.");
  if (!NEXT[ret.prep_status].includes(next)) throw new ValidationError(`A return that is "${ret.prep_status.replace(/_/g, " ")}" can't go straight to "${next.replace(/_/g, " ")}".`);
  const saved = await deps.ws.updateReturn(ret.id, { prep_status: next });
  await deps.audit({ actor_id: scope.userId, action: "prep_status_changed", subject_type: "client_return", subject_id: ret.id, detail: { from: ret.prep_status, to: next } });
  return saved;
}

export async function savePrepNotes(deps: PrepDeps, scope: Scope, returnId: string, notes: unknown): Promise<ClientReturn> {
  const { ret } = await loadReturn(deps, scope, returnId);
  if (ret.prep_status === "handed_off") throw new ValidationError("This return was handed to an ERO and can't be changed here.");
  const text = typeof notes === "string" ? notes.replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim().slice(0, 2000) : "";
  const saved = await deps.ws.updateReturn(ret.id, { notes: text || null });
  await deps.audit({ actor_id: scope.userId, action: "prep_notes_saved", subject_type: "client_return", subject_id: ret.id });
  return saved;
}

/**
 * Hands a return to another preparer of the same account or office. Only a person with `all`, or the client's owner,
 * may assign; the new preparer must be an active member (`memberIds`), and a handed-off return stays where it is.
 */
export async function assignReturn(deps: PrepDeps, scope: Scope, returnId: string, assigneeId: string, memberIds: string[]): Promise<ClientReturn> {
  const { ret, client } = await loadReturn(deps, scope, returnId);
  if (ret.prep_status === "handed_off") throw new ValidationError("This return was handed to an ERO and can't be reassigned.");
  if (!scope.all && client.owner_id !== scope.userId) throw new ValidationError("Only the client's owner or the office's ERO can assign this return.");
  if (!memberIds.includes(assigneeId)) throw new ValidationError("Choose someone who works here.");
  if (ret.assignee_id === assigneeId) return ret;
  const saved = await deps.ws.updateReturn(ret.id, { assignee_id: assigneeId });
  await deps.audit({ actor_id: scope.userId, action: "return_assigned", subject_type: "client_return", subject_id: ret.id, detail: { from: ret.assignee_id, to: assigneeId } });
  return saved;
}

// ---------------------------------------------------------------- checklist

export async function checklistFor(deps: PrepDeps, scope: Scope, returnId: string): Promise<ChecklistItem[]> {
  const { ret } = await loadReturn(deps, scope, returnId);
  return deps.prep.listChecklist(ret.id);
}

export async function addChecklistItem(deps: PrepDeps, scope: Scope, returnId: string, label: unknown): Promise<ChecklistItem> {
  const { ret } = await loadReturn(deps, scope, returnId);
  if (ret.prep_status === "handed_off") throw new ValidationError("This return was handed to an ERO and can't be changed here.");
  const text = line(label, 200);
  if (!text) throw new ValidationError("Write the checklist item.");
  const items = await deps.prep.listChecklist(ret.id);
  if (items.length >= 40) throw new ValidationError("A checklist can have up to 40 items.");
  const [item] = await deps.prep.insertChecklist(ret.id, [text], Math.max(-1, ...items.map((i) => i.position)) + 1);
  return item;
}

async function itemFor(deps: PrepDeps, scope: Scope, itemId: unknown): Promise<{ item: ChecklistItem; ret: ClientReturn }> {
  const item = typeof itemId === "string" && UUID.test(itemId) ? await deps.prep.getChecklistItem(itemId) : null;
  if (!item) return notFound("That checklist item");
  const { ret } = await loadReturn(deps, scope, item.return_id);
  if (ret.prep_status === "handed_off") throw new ValidationError("This return was handed to an ERO and can't be changed here.");
  return { item, ret };
}

export async function setChecklistDone(deps: PrepDeps, scope: Scope, itemId: unknown, done: boolean): Promise<ChecklistItem> {
  const { item } = await itemFor(deps, scope, itemId);
  return deps.prep.updateChecklistItem(item.id, done ? { done_at: nowOf(deps).toISOString(), done_by: scope.userId } : { done_at: null, done_by: null });
}
export async function removeChecklistItem(deps: PrepDeps, scope: Scope, itemId: unknown): Promise<void> {
  const { item } = await itemFor(deps, scope, itemId);
  await deps.prep.deleteChecklistItem(item.id);
}

// ---------------------------------------------------------------- handing a return to an ERO

/** What sending needs: the account's mail sender, its sending address, and the non-production test allow-list. */
export type HandoffMail = { email: EmailSender; sender: () => Promise<ResolvedSender>; env: "production" | "preview" | "development"; testRecipients: string[]; docs: (clientId: string) => Promise<Pick<ClientDoc, "title" | "file_type">[]>; preparerName: string; preparerEmail: string | null };

/**
 * Emails an ERO a file with the return's details. The return must be ready for review. Nothing is shared: the ERO
 * imports the file on their side. The send is recorded either way; on success the return becomes "handed to ERO" and
 * is locked here.
 */
export async function handOff(deps: PrepDeps, scope: Scope, returnId: string, toRaw: unknown, mail: HandoffMail): Promise<Handoff> {
  const { ret, client } = await loadReturn(deps, scope, returnId);
  if (ret.prep_status === "handed_off") throw new ValidationError("This return was already handed to an ERO.");
  if (ret.prep_status !== "ready_for_review") throw new ValidationError("Mark the return ready for review before handing it to an ERO.");
  const to = line(toRaw, 254).toLowerCase();
  if (!isEmailAddress(to)) throw new ValidationError("Enter the ERO's email address.");
  if (mail.env !== "production" && !mail.testRecipients.map((r) => r.toLowerCase()).includes(to)) {
    throw new ValidationError(`Not sent: this is a ${mail.env} copy of the app, which only contacts addresses on the test list (AUTOMATION_TEST_RECIPIENTS).`);
  }
  const items = await deps.prep.listChecklist(ret.id);
  const csv = handoffCsv({ client, ret, items, docs: await mail.docs(client.id), preparer: mail.preparerName });
  const fileName = handoffFileName(client, ret);
  const hash = sha256(csv);
  const from = await mail.sender();
  const body = [
    `${mail.preparerName} is handing you the ${ret.tax_year} return for ${client.full_name}.`,
    "", "The attached file has the client's details, the prep notes, the intake checklist and the documents on file. Import it into your own records; nothing is shared between our accounts.",
    ...(mail.preparerEmail ? ["", `Questions: reply to this email (${mail.preparerEmail}).`] : []),
  ].join("\n");
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const result = await mail.email.send({
    to, subject: `Return handoff: ${client.full_name} (${ret.tax_year})`, text: body,
    html: body.split("\n\n").map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join(""),
    idempotencyKey: `handoff:${ret.id}:${hash.slice(0, 16)}`, from: from.from, replyTo: mail.preparerEmail ?? from.replyTo,
    attachments: [{ filename: fileName, content: new TextEncoder().encode(csv) }],
  });
  if (!result.ok && result.kind === "config") throw new ValidationError(result.message);
  const record = await deps.prep.insertHandoff({ return_id: ret.id, to_email: to, file_name: fileName, file_sha256: hash, status: result.ok ? "sent" : "failed", error: result.ok ? null : sanitizeError(result.message, 300), sent_by: scope.userId });
  await deps.audit({ actor_id: scope.userId, action: result.ok ? "return_handed_off" : "return_handoff_failed", subject_type: "client_return", subject_id: ret.id, detail: { to, file_sha256: hash } });
  if (!result.ok) throw new ValidationError(`Not sent. ${sanitizeError(result.message, 200)}`);
  await deps.ws.updateReturn(ret.id, { prep_status: "handed_off", handed_off_at: nowOf(deps).toISOString() });
  return record;
}
