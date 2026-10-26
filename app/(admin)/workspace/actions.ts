"use server";

import { deletedNotice } from "@/lib/storage/window.ts";
import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { pipelinesRepo } from "@/lib/pipelines/server";
import { isLive, returnsStages } from "@/lib/pipelines/service.ts";
import { clientDocLink, deleteClientDoc, finishClientDoc, startClientDoc } from "@/lib/workspace/docs.ts";
import { emitInvoicePaid, emitReturnStage, emitTagChanges, emitWorkStage } from "@/lib/automation/emit";
import { yesNo } from "@/lib/workspace/rules.ts";
import { addBusiness, addClient, addWork, moveWork, addDependent, linkSpouse, mergeClients, removeBusiness, removeDependent, removeSpouse, saveClientTags, saveClientWithChanges, saveSpouse, saveBillingSettings, editInvoice, archiveInvoice, setPaymentPlan, removePaymentPlan, addFeeProduct, saveFeeProduct, archiveFeeProduct, unlinkSpouse, type Actor, addNote, addReturn, addTask, applyImport, createInvoice, discardImport, logMessage, moveReturn, recordPayment, saveReview, sendInvoice, setTaskDone, startImport, voidInvoice, type RowEdit } from "@/lib/workspace/service.ts";
import { docDeps, sendDeps, workspaceRepo } from "@/lib/workspace/server";
import { documentDeps } from "@/lib/documents/server";
import { moveFile } from "@/lib/documents/folders.ts";
import { clientScope, driveBack } from "@/lib/workspace/doc-folders.ts";
import { setWorkflowTaskDone } from "@/lib/workspace/workflow-tasks";
import { sendClientMessage } from "@/lib/workspace/send.ts";
import { loadBrand } from "@/lib/branding/server";
import { cancelOpenPayment, canTakePayments } from "@/lib/connect/service.ts";
import { connectDeps } from "@/lib/connect/server";
import { invoiceNoticeEmail } from "@/lib/portal/invoices.ts";
import { portalLink, portalMemberRepo, sendPortalEmail } from "@/lib/portal/server";
import { portalMessageEmail } from "@/lib/portal/invoices.ts";
import { createLead } from "@/lib/leads/service.ts";
import { leadsDeps } from "@/lib/leads/server";
import { commerceRepo } from "@/lib/admin";
import { currentTier } from "@/lib/tier-server";
import { allows } from "@/lib/tier.ts";
import { currentTenantId } from "@/lib/tenants.ts";
import { checkSsn, copySsn, hasStoredSsn, revealSsn, storeSsn } from "@/lib/ssn/service.ts";
import { revealGate, ssnDeps } from "@/lib/ssn/server";
import type { Invoice } from "@/lib/workspace/types";

// My Workspace actions. Each re-checks administrator access and acts only on the current tenant's rows.

const str = (form: FormData, k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string) : "");
const raw = (form: FormData) => Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")) as Record<string, string>;
const to = (path: string, key: "notice" | "error", message: string) => `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(message)}`;

const failure = (e: unknown) => {
  if (e instanceof ValidationError) return e.message;
  console.error(`workspace action failed: ${sanitizeError(e, 200)}`);
  if (/relation|schema cache|does not exist/i.test(e instanceof Error ? e.message : "")) return "My Workspace isn't installed yet. Apply the workspace migration first.";
  return "That did not work. Nothing was changed. Please try again.";
};

async function act(back: string, fn: (adminId: string) => Promise<{ to?: string; notice: string }>) {
  const admin = await requireAdmin();
  let target: string;
  try {
    const r = await fn(admin.userId);
    target = to(r.to ?? back, "notice", r.notice);
  } catch (e) {
    unstable_rethrow(e);
    target = to(back, "error", failure(e));
  }
  revalidatePath("/workspace", "layout");
  redirect(target);
}

/** Emails the client that an invoice is in their portal, when they have portal access. Returns whether an email went out. */
async function tellPortalClient(invoice: Invoice): Promise<boolean> {
  const tenantId = currentTenantId();
  const member = await portalMemberRepo(tenantId).getForClient(invoice.client_id);
  if (!member || member.status !== "active") return false;
  const office = (await loadBrand(tenantId)).name;
  const link = await portalLink("/invoices");
  const problem = await sendPortalEmail(tenantId, member.email, invoiceNoticeEmail({ office, name: member.full_name, number: invoice.number, totalCents: invoice.total_cents, link }));
  return problem === null;
}

async function onlinePaymentsOn(): Promise<boolean> {
  const deps = connectDeps(currentTenantId());
  return deps ? canTakePayments(await deps.repo.getConnection(), deps.stripe.livemode) : false;
}

/** The signed-in person, for the record of who changed what. */
const whoIs = async (): Promise<Actor> => { const a = await requireAdmin(); return { id: a.userId, email: a.email }; };

const clientPage = (id: string, tab = "overview") => `/workspace/clients/${id}?tab=${tab}`;

// ---- clients

/** The full number typed in the form, checked before anything is saved so a bad number never leaves a half-saved client. */
const typedSsn = (form: FormData): string | null => (str(form, "ssn").trim() ? checkSsn(str(form, "ssn")) : null);

export async function addClientAction(form: FormData) {
  await act("/workspace/clients", async (adminId) => {
    const ssn = typedSsn(form);
    const c = await addClient(workspaceRepo(), raw(form), adminId, null, await whoIs());
    if (ssn) await storeSsn(ssnDeps(), { clientId: c.id, ssn, actorId: adminId });
    return { to: clientPage(c.id), notice: "Client added." };
  });
}

/** The one Add button: a client, a lead or (on plans with the store) a customer. Errors come back to the popup so nothing typed is lost. */
export async function addContactAction(form: FormData): Promise<{ error: string; field?: string } | undefined> {
  const admin = await requireAdmin();
  let to: string;
  try {
    const kind = str(form, "kind");
    const fields = raw(form);
    const name = [str(form, "first_name"), str(form, "last_name")].map((s) => s.trim()).filter(Boolean).join(" ");
    const tier = await currentTier();
    if (kind === "client") {
      const ssn = typedSsn(form);
      const c = await addClient(workspaceRepo(), fields, admin.userId, null, { id: admin.userId, email: admin.email });
      if (ssn) await storeSsn(ssnDeps(), { clientId: c.id, ssn, actorId: admin.userId });
      to = clientPage(c.id);
    } else if (kind === "lead") {
      if (!str(form, "first_name").trim()) throw new ValidationError("Enter the first name.");
      const lead = await createLead(leadsDeps(), { ...fields, full_name: name }, admin.userId);
      to = allows(tier, "leads") ? `/leads/${lead.id}` : `/contacts/lead-${lead.id}`;
    } else if (kind === "customer") {
      if (!allows(tier, "store")) throw new ValidationError("Customers aren't part of this plan.");
      const email = str(form, "email").trim().toLowerCase();
      if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ValidationError("A customer needs a name and an email address.");
      const c = await commerceRepo().createCustomer({ email, full_name: name, stripe_customer_id: null });
      to = `/customers/${c.id}`;
    } else {
      throw new ValidationError("Choose client, lead or customer.");
    }
  } catch (e) {
    unstable_rethrow(e);
    return { error: failure(e) };
  }
  revalidatePath("/contacts");
  revalidatePath("/workspace", "layout");
  redirect(to);
}

/** Shows one client's full SSN or ITIN for a few seconds after the person types their password again. Every try is recorded. */
export async function revealClientSsnAction(clientId: string, password: string): Promise<{ ssn?: string; seconds?: number; error?: string }> {
  try {
    const admin = await requireAdmin();
    const gate = await revealGate({ userId: admin.userId, email: admin.email });
    const r = await revealSsn(ssnDeps(), gate, { clientId, password });
    return { ssn: r.ssn, seconds: r.seconds };
  } catch (e) {
    unstable_rethrow(e);
    return { error: failure(e) };
  }
}

export async function archiveClientAction(form: FormData) {
  const id = str(form, "id");
  await act(clientPage(id), async () => {
    if (str(form, "confirm") !== "yes") throw new ValidationError("Tick the box to confirm.");
    const repo = workspaceRepo();
    if (!(await repo.getClient(id))) throw new ValidationError("That client wasn't found.");
    await repo.updateClient(id, { archived_at: str(form, "restore") === "yes" ? null : new Date().toISOString() });
    return { to: "/workspace/clients", notice: str(form, "restore") === "yes" ? "Client restored." : "Client archived. Their returns, invoices and documents are kept." };
  });
}

// ---- returns and the My Work board

async function firstStage() {
  const { stages } = returnsStages(await pipelinesRepo().list().catch(() => []));
  return stages;
}

export async function addReturnAction(form: FormData) {
  const back = str(form, "back").startsWith("/workspace") ? str(form, "back") : "/workspace/work";
  await act(back, async () => {
    const stages = await firstStage();
    const r = await addReturn(workspaceRepo(), raw(form), stages[0].id);
    return { notice: `${r.kind === "original" ? "Return" : r.kind === "extension" ? "Extension" : "Amendment"} added for ${r.tax_year}.` };
  });
}

/** Adds a piece of work that is not a tax return to the chosen pipeline. */
export async function addWorkAction(form: FormData) {
  const pipelineId = str(form, "pipeline_id");
  const back = `/workspace/work?pipeline=${encodeURIComponent(pipelineId)}`;
  await act(back, async (adminId) => {
    const pipeline = (await pipelinesRepo().list()).find((p) => p.id === pipelineId && isLive(p));
    if (!pipeline) throw new ValidationError("Choose a pipeline.");
    await addWork(workspaceRepo(), raw(form), pipeline, adminId);
    return { notice: `Added to ${pipeline.name}.` };
  });
}

/** Called by the board when work in another pipeline is dropped on a stage. */
export async function moveWorkAction(workId: string, stageId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireAdmin();
    const work = await workspaceRepo().getWork(workId);
    const pipeline = work ? (await pipelinesRepo().list()).find((p) => p.id === work.pipeline_id) : null;
    if (!pipeline) throw new ValidationError("That work wasn't found.");
    await moveWork(workspaceRepo(), workId, stageId, pipeline.stages.map((s) => s.id));
    if (work) await emitWorkStage(work.id, work.client_id, work.pipeline_id, stageId);
    revalidatePath("/workspace", "layout");
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: failure(e) };
  }
}

/** Called by the board when a card is dropped on another stage. */
export async function moveReturnAction(returnId: string, stageId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireAdmin();
    const stages = await firstStage();
    await moveReturn(workspaceRepo(), returnId, stageId, stages.map((s) => s.id));
    await emitReturnStage(returnId, stageId);
    revalidatePath("/workspace", "layout");
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: failure(e) };
  }
}

// ---- tasks, notes, messages

export async function addTaskAction(form: FormData) {
  const id = str(form, "client_id");
  // From the Calendar's task list the person stays on the Calendar.
  const back = str(form, "back").startsWith("/calendar") ? str(form, "back") : clientPage(id, "tasks");
  await act(back, async (adminId) => {
    await addTask(workspaceRepo(), id, raw(form), adminId);
    // From the Calendar, land on the month the task is due in so it can be seen straight away.
    const due = str(form, "due_on");
    if (back.startsWith("/calendar") && /^\d{4}-\d{2}-\d{2}$/.test(due)) return { to: `/calendar?view=month&date=${due}`, notice: "Task added to the calendar." };
    return { notice: "Task added." };
  });
}

export async function toggleTaskAction(form: FormData) {
  const back = /^\/(workspace|calendar)/.test(str(form, "back")) ? str(form, "back") : "/workspace";
  await act(back, async () => {
    if (str(form, "source") === "workflow") await setWorkflowTaskDone(str(form, "id"), str(form, "done") === "yes");
    else await setTaskDone(workspaceRepo(), str(form, "id"), str(form, "done") === "yes");
    return { notice: str(form, "done") === "yes" ? "Task done." : "Task reopened." };
  });
}

export async function addNoteAction(form: FormData) {
  const id = str(form, "client_id");
  await act(clientPage(id, "notes"), async (adminId) => {
    await addNote(workspaceRepo(), id, str(form, "body"), adminId);
    return { notice: "Note added." };
  });
}

export async function sendMessageAction(form: FormData) {
  const id = str(form, "client_id");
  await act(clientPage(id, "messages"), async (adminId) => {
    const m = await sendClientMessage(await sendDeps(), id, raw(form), adminId);
    return { notice: m.channel === "sms" ? `Text sent to ${m.sent_to}${m.segments && m.segments > 1 ? ` (${m.segments} message segments)` : ""}.` : `Email sent to ${m.sent_to}.` };
  });
}

/** A message written to the client's portal, with an email telling them it is waiting. */
export async function sendPortalMessageAction(form: FormData) {
  const id = str(form, "client_id");
  await act(clientPage(id, "messages"), async (adminId) => {
    const tenantId = currentTenantId();
    const repo = workspaceRepo();
    const client = await repo.getClient(id);
    if (!client) throw new ValidationError("That client wasn't found.");
    if (client.archived_at) throw new ValidationError("This client is archived. Restore them to send messages.");
    const body = str(form, "body").replace(/\r\n/g, "\n").trim().slice(0, 4000);
    if (!body) throw new ValidationError("Write the message.");
    const member = await portalMemberRepo(tenantId).getForClient(id);
    if (!member || member.status !== "active") throw new ValidationError("This client doesn't have portal access yet. Use Send invite at the top of this page.");
    const subject = str(form, "subject").replace(/\s+/g, " ").trim().slice(0, 200);
    await repo.insertMessage({ client_id: id, direction: "out", channel: "portal", subject: subject || null, body, occurred_at: new Date().toISOString(), created_by: adminId, status: "sent", sent_to: member.email });
    const office = (await loadBrand(tenantId)).name;
    const problem = await sendPortalEmail(tenantId, member.email, portalMessageEmail({ office, name: member.full_name, link: await portalLink("/messages") }));
    return { notice: problem ? `The message is in the portal, but the email telling them didn't go out (${problem}).` : `Message sent to ${member.email}'s portal.` };
  });
}

export async function logMessageAction(form: FormData) {
  const id = str(form, "client_id");
  await act(clientPage(id, "messages"), async (adminId) => {
    await logMessage(workspaceRepo(), id, raw(form), adminId);
    return { notice: "Message logged." };
  });
}

// ---- household: spouse, dependents, businesses

export async function linkSpouseAction(form: FormData) {
  const id = str(form, "id");
  await act(clientPage(id), async () => { await linkSpouse(workspaceRepo(), id, str(form, "spouse_id"), await whoIs(), yesNo(form.get("filed_last_year"))); return { notice: "Spouse linked." }; });
}
export async function unlinkSpouseAction(form: FormData) {
  const id = str(form, "id");
  await act(clientPage(id), async () => { await unlinkSpouse(workspaceRepo(), id, await whoIs()); return { notice: "Spouse unlinked." }; });
}
export async function saveSpouseAction(form: FormData) {
  const id = str(form, "client_id");
  await act(clientPage(id), async () => { await saveSpouse(workspaceRepo(), raw(form), await whoIs()); return { notice: "Spouse saved." }; });
}
export async function removeSpouseAction(form: FormData) {
  const id = str(form, "client_id");
  await act(clientPage(id), async () => { await removeSpouse(workspaceRepo(), id, await whoIs()); return { notice: "Spouse removed." }; });
}
export async function addDependentAction(form: FormData) {
  const id = str(form, "client_id");
  await act(clientPage(id), async (adminId) => { await addDependent(workspaceRepo(), raw(form), adminId, await whoIs()); return { notice: "Dependent added." }; });
}
export async function removeDependentAction(form: FormData) {
  const id = str(form, "client_id");
  await act(clientPage(id), async () => { await removeDependent(workspaceRepo(), id, str(form, "id"), await whoIs()); return { notice: "Dependent removed." }; });
}
export async function addBusinessAction(form: FormData) {
  const id = str(form, "client_id");
  await act(clientPage(id), async (adminId) => { await addBusiness(workspaceRepo(), raw(form), adminId, await whoIs()); return { notice: "Business added." }; });
}
export async function removeBusinessAction(form: FormData) {
  const id = str(form, "client_id");
  await act(clientPage(id), async () => { await removeBusiness(workspaceRepo(), id, str(form, "id"), await whoIs()); return { notice: "Business removed." }; });
}

/** The Details card's Save: on a problem the card stays open with what was typed and says what is wrong. */
export async function saveClientDetailsAction(form: FormData): Promise<{ error: string; field?: string } | undefined> {
  const id = str(form, "id");
  let notice: string;
  try {
    const admin = await requireAdmin();
    const ssn = typedSsn(form);
    const { changes } = await saveClientWithChanges(workspaceRepo(), id, raw(form), { id: admin.userId, email: admin.email });
    if (ssn) await storeSsn(ssnDeps(), { clientId: id, ssn, actorId: admin.userId });
    const names = [...changes.map((c) => c.field), ...(ssn ? ["Social Security number"] : [])];
    notice = names.length ? `Saved. Updated ${names.join(", ")}.` : "Nothing was changed.";
  } catch (e) {
    unstable_rethrow(e);
    return { error: failure(e) };
  }
  revalidatePath("/workspace", "layout");
  redirect(to(clientPage(id), "notice", notice));
}

/** Saves the tags on a contact's card, then tells Automation which were added or removed. */
export async function saveClientTagsAction(form: FormData) {
  const id = str(form, "id");
  await act(clientPage(id), async (adminId) => {
    const admin = await requireAdmin();
    const { before, after } = await saveClientTags(workspaceRepo(), id, str(form, "tags"), { id: adminId, email: admin.email });
    await emitTagChanges({ type: "client", id }, before, after);
    return { notice: before.join() === after.join() ? "Tags are unchanged." : "Tags saved." };
  });
}

/** Merges a duplicate into the client being kept: everything moves over, the duplicate is archived. */
export async function mergeClientsAction(form: FormData) {
  const keep = str(form, "keep");
  const drop = str(form, "drop");
  await act(clientPage(keep), async (adminId) => {
    const ssn = ssnDeps();
    if (!(await hasStoredSsn(ssn, keep)) && (await hasStoredSsn(ssn, drop))) await copySsn(ssn, { from: drop, to: keep, actorId: adminId });
    const moved = await mergeClients(workspaceRepo(), keep, drop, await whoIs());
    const parts = Object.entries(moved).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`);
    return { notice: `Merged. ${parts.length ? `Moved ${parts.join(", ")}.` : "Nothing needed moving."} The other record is archived.` };
  });
}

/** Merges a duplicate lead into a client: the lead's details are kept as a note on the client and the lead is marked converted. */
export async function mergeLeadIntoClientAction(form: FormData) {
  const clientId = str(form, "client_id");
  const leadId = str(form, "lead_id");
  await act(clientPage(clientId), async (adminId) => {
    const leads = leadsDeps().repo;
    const lead = await leads.getLead(leadId);
    if (!lead) throw new ValidationError("That lead wasn't found.");
    const repo = workspaceRepo();
    if (!(await repo.getClient(clientId))) throw new ValidationError("That client wasn't found.");
    const detail = [`Merged from lead ${lead.full_name}`, lead.email, lead.phone, lead.source ? `Source: ${lead.source}` : "", lead.notes ?? ""].filter(Boolean).join("\n");
    await repo.insertNote({ client_id: clientId, body: detail.slice(0, 4000), created_by: adminId });
    await leads.updateLead(leadId, { status: "converted" });
    return { notice: `Lead ${lead.full_name} merged into this client and marked converted.` };
  });
}

export async function setPaymentPlanAction(form: FormData) {
  const back = /^\/workspace/.test(str(form, "back")) ? str(form, "back") : "/workspace/billing";
  await act(back, async () => { const plan = await setPaymentPlan(workspaceRepo(), str(form, "id"), raw(form)); return { notice: `Payment plan set up: ${plan.length} payments.` }; });
}

export async function removePaymentPlanAction(form: FormData) {
  const back = /^\/workspace/.test(str(form, "back")) ? str(form, "back") : "/workspace/billing";
  await act(back, async () => { await removePaymentPlan(workspaceRepo(), str(form, "id")); return { notice: "Payment plan removed." }; });
}

export async function editInvoiceAction(form: FormData) {
  const back = /^\/workspace/.test(str(form, "back")) ? str(form, "back") : "/workspace/billing";
  await act(back, async () => {
    const r = await editInvoice(workspaceRepo(), str(form, "id"), raw(form));
    // A pay link made for the old total must not be payable any more.
    if (r.totalChanged) { const deps = connectDeps(currentTenantId()); if (deps) await cancelOpenPayment(deps, r.invoice.id).catch(() => false); }
    return { notice: `${r.invoice.number} saved.${r.planRemoved ? " Its payment plan was removed because the total changed. Set it up again." : ""}` };
  });
}

export async function archiveInvoiceAction(form: FormData) {
  const back = /^\/workspace/.test(str(form, "back")) ? str(form, "back") : "/workspace/billing";
  await act(back, async () => {
    const archive = str(form, "archive") === "yes";
    const i = await archiveInvoice(workspaceRepo(), str(form, "id"), archive);
    return { notice: archive ? `${i.number} archived. Find it under Archived on Billing.` : `${i.number} restored.` };
  });
}

/** Billing settings (Settings → Billing): the footer printed on invoices and the sales tax percent. */
export async function saveBillingSettingsAction(form: FormData) {
  await act("/settings/billing", async (adminId) => { await saveBillingSettings(workspaceRepo(), raw(form), adminId); return { notice: "Saved. New invoices use these." }; });
}

export async function addFeeProductAction(form: FormData) {
  await act("/settings/billing", async (adminId) => { const p = await addFeeProduct(workspaceRepo(), raw(form), adminId); return { notice: `${p.name} added.` }; });
}

export async function saveFeeProductAction(form: FormData) {
  await act("/settings/billing", async () => { const p = await saveFeeProduct(workspaceRepo(), str(form, "id"), raw(form)); return { notice: `${p.name} saved.` }; });
}

export async function archiveFeeProductAction(form: FormData) {
  await act("/settings/billing", async () => { await archiveFeeProduct(workspaceRepo(), str(form, "id")); return { notice: "Removed. Invoices already made keep what they were made with." }; });
}

// ---- documents (uploaded straight to private storage, then checked)

export type Ticket = { ok: true; id: string; uploadUrl: string; contentType: string } | { ok: false; error: string };

export async function startClientDocAction(input: { clientId: string; title: string; fileName: string; sizeBytes: number; returnId?: string; folderId?: string }): Promise<Ticket> {
  try {
    const admin = await requireAdmin();
    const t = await startClientDoc(docDeps(), input, admin.userId);
    if (input.folderId) await moveFile(clientScope(documentDeps().repo, workspaceRepo(), input.clientId), t.doc.id, input.folderId).catch(() => undefined);
    return { ok: true, id: t.doc.id, uploadUrl: t.uploadUrl, contentType: t.contentType };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: failure(e) };
  }
}

export async function finishClientDocAction(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireAdmin();
    await finishClientDoc(docDeps(), id);
    revalidatePath("/workspace", "layout");
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: failure(e) };
  }
}

export async function openClientDocAction(form: FormData) {
  await requireAdmin();
  let url: string;
  try {
    url = await clientDocLink(docDeps(), str(form, "id"));
  } catch (e) {
    unstable_rethrow(e);
    redirect(to(driveBack(str(form, "back"), clientPage(str(form, "client_id"), "documents")), "error", failure(e)));
  }
  redirect(url);
}

export async function deleteClientDocAction(form: FormData) {
  const client = str(form, "client_id");
  await act(driveBack(str(form, "back"), clientPage(client, "documents")), async () => {
    await deleteClientDoc(docDeps(), str(form, "id"));
    return { notice: deletedNotice("Document") };
  });
}

// ---- billing

export async function createInvoiceAction(form: FormData) {
  const back = str(form, "back").startsWith("/workspace") ? str(form, "back") : "/workspace/billing";
  await act(back, async (adminId) => {
    const i = await createInvoice(workspaceRepo(), raw(form), adminId);
    return { notice: `Invoice ${i.number} created.` };
  });
}

export async function invoiceStatusAction(form: FormData) {
  const back = str(form, "back").startsWith("/workspace") ? str(form, "back") : "/workspace/billing";
  await act(back, async (adminId) => {
    const repo = workspaceRepo();
    if (str(form, "do") === "send") {
      const i = await sendInvoice(repo, str(form, "id"));
      // Sending shows the invoice in the client's portal. If they have portal access, tell them by email.
      const told = await tellPortalClient(i).catch(() => false);
      const online = await onlinePaymentsOn().catch(() => false);
      return { notice: `${i.number} sent to the client's portal${told ? " and they were emailed" : ""}.${online ? "" : " Online payment is off, so there's no pay button yet (Settings → Payments)."}` };
    }
    if (str(form, "do") === "void") { const i = await voidInvoice(repo, str(form, "id")); return { notice: `${i.number} voided.` }; }
    const i = await recordPayment(repo, str(form, "id"), str(form, "amount"), str(form, "paid_on"), new Date(), { method: str(form, "method"), reference: str(form, "reference"), actorId: adminId });
    await emitInvoicePaid(i.id, undefined, adminId);
    return { notice: i.status === "paid" ? `${i.number} is paid.` : `Payment recorded on ${i.number}.` };
  });
}

// ---- bank statement import

export async function importPaymentsAction(form: FormData) {
  const admin = await requireAdmin();
  let target: string;
  try {
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new ValidationError("Choose a CSV file.");
    if (file.size > 2_000_000) throw new ValidationError("That file is larger than 2 MB. Split it and import each part.");
    if (!/\.csv$/i.test(file.name) && !/csv|text\/plain/i.test(file.type)) throw new ValidationError("Choose a .csv file (most banks offer one under Download or Export).");
    const started = await startImport(workspaceRepo(), file.name, await file.text(), admin.userId);
    target = to(`/workspace/billing/import/${started.import.id}`, "notice", `${started.rows.length} deposits read${started.skipped ? `; ${started.skipped} money-out or empty rows skipped` : ""}.${started.duplicateOf ? " You imported a file with exactly these contents before: check you aren't applying the same payments twice." : ""} Review each one before applying.`);
  } catch (e) {
    unstable_rethrow(e);
    target = to("/workspace/billing/import", "error", failure(e));
  }
  revalidatePath("/workspace", "layout");
  redirect(target);
}

function edits(form: FormData): RowEdit[] {
  // Rows already applied have no controls on the page, so they send nothing.
  const ids = form.getAll("row").map(String).filter((rowId) => form.has(`amount_${rowId}`));
  return ids.map((rowId) => ({ rowId, invoiceId: str(form, `invoice_${rowId}`) || null, amount: str(form, `amount_${rowId}`), ignore: str(form, `ignore_${rowId}`) === "on" }));
}

export async function reviewImportAction(form: FormData) {
  const id = str(form, "id");
  await act(`/workspace/billing/import/${id}`, async () => {
    const repo = workspaceRepo();
    const mode = str(form, "do");
    if (mode === "discard") { await discardImport(repo, id); return { to: "/workspace/billing", notice: "Import discarded. Nothing was changed." }; }
    await saveReview(repo, id, edits(form));
    if (mode === "save") return { notice: "Changes saved. Nothing has been applied yet." };
    const chosen = form.getAll("apply").map(String);
    if (!chosen.length) throw new ValidationError("Tick the payments you want to apply.");
    const r = await applyImport(repo, id, chosen);
    for (const row of await repo.listImportRows(id)) if (chosen.includes(row.id) && row.invoice_id) await emitInvoicePaid(row.invoice_id);
    return { notice: `${r.applied} payment${r.applied === 1 ? "" : "s"} applied to invoices.${r.overpaid ? ` ${r.overpaid} was more than the balance; the invoice is paid in full and the extra was not recorded.` : ""}` };
  });
}
