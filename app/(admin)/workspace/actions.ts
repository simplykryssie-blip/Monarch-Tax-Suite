"use server";

import { deletedNotice } from "@/lib/storage/window.ts";
import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { pipelinesRepo } from "@/lib/pipelines/server";
import { returnsStages } from "@/lib/pipelines/service.ts";
import { clientDocLink, deleteClientDoc, finishClientDoc, startClientDoc } from "@/lib/workspace/docs.ts";
import { addClient, addNote, addReturn, addTask, applyImport, createInvoice, discardImport, logMessage, moveReturn, recordPayment, saveClient, saveReview, sendInvoice, setTaskDone, startImport, voidInvoice, type RowEdit } from "@/lib/workspace/service.ts";
import { docDeps, sendDeps, workspaceRepo } from "@/lib/workspace/server";
import { sendClientMessage } from "@/lib/workspace/send.ts";

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

const clientPage = (id: string, tab = "overview") => `/workspace/clients/${id}?tab=${tab}`;

// ---- clients

export async function addClientAction(form: FormData) {
  await act("/workspace/clients", async (adminId) => {
    const c = await addClient(workspaceRepo(), raw(form), adminId);
    return { to: clientPage(c.id), notice: "Client added." };
  });
}

export async function saveClientAction(form: FormData) {
  const id = str(form, "id");
  await act(clientPage(id), async () => {
    await saveClient(workspaceRepo(), id, raw(form));
    return { notice: "Saved." };
  });
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

/** Called by the board when a card is dropped on another stage. */
export async function moveReturnAction(returnId: string, stageId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireAdmin();
    const stages = await firstStage();
    await moveReturn(workspaceRepo(), returnId, stageId, stages.map((s) => s.id));
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
  await act(clientPage(id, "tasks"), async (adminId) => {
    await addTask(workspaceRepo(), id, raw(form), adminId);
    return { notice: "Task added." };
  });
}

export async function toggleTaskAction(form: FormData) {
  const back = str(form, "back").startsWith("/workspace") ? str(form, "back") : "/workspace";
  await act(back, async () => {
    await setTaskDone(workspaceRepo(), str(form, "id"), str(form, "done") === "yes");
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

export async function logMessageAction(form: FormData) {
  const id = str(form, "client_id");
  await act(clientPage(id, "messages"), async (adminId) => {
    await logMessage(workspaceRepo(), id, raw(form), adminId);
    return { notice: "Message logged." };
  });
}

// ---- documents (uploaded straight to private storage, then checked)

export type Ticket = { ok: true; id: string; uploadUrl: string; contentType: string } | { ok: false; error: string };

export async function startClientDocAction(input: { clientId: string; title: string; fileName: string; sizeBytes: number; returnId?: string }): Promise<Ticket> {
  try {
    const admin = await requireAdmin();
    const t = await startClientDoc(docDeps(), input, admin.userId);
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
    redirect(to(clientPage(str(form, "client_id"), "documents"), "error", failure(e)));
  }
  redirect(url);
}

export async function deleteClientDocAction(form: FormData) {
  const client = str(form, "client_id");
  await act(clientPage(client, "documents"), async () => {
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
  await act(back, async () => {
    const repo = workspaceRepo();
    if (str(form, "do") === "send") { const i = await sendInvoice(repo, str(form, "id")); return { notice: `${i.number} marked sent.` }; }
    if (str(form, "do") === "void") { const i = await voidInvoice(repo, str(form, "id")); return { notice: `${i.number} voided.` }; }
    const i = await recordPayment(repo, str(form, "id"), str(form, "amount"), str(form, "paid_on"));
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
    return { notice: `${r.applied} payment${r.applied === 1 ? "" : "s"} applied to invoices.${r.overpaid ? ` ${r.overpaid} was more than the balance; the invoice is paid in full and the extra was not recorded.` : ""}` };
  });
}
