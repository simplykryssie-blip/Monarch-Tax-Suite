"use server";

import { DELETE_NOTICE, deletedNotice } from "@/lib/storage/window.ts";
import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { requireOffice } from "@/lib/office/server";
import { brandName, complianceDeps, ctxFor } from "@/lib/compliance/server";
import {
  acknowledge, attest, buildWisp, closeIncident, create8879, createItem, delete8879, deleteDocument, deleteItem, finishUpload, markStep, recordRenewal,
  reopenIncident, saveSettings, setItemDone, startIncident, startUpload, update8879, updateIncident, updateItem, UUID,
} from "@/lib/compliance/service.ts";
import { ALL_FIELDS } from "@/lib/wisp/content.ts";

// Compliance Center actions. Each one re-checks who is signed in (with two-step sign-in), their office and what they
// may reach; the tenant-scoped client keeps everything inside their tenant, and the service keeps it in their office.

type FormResult = { error: string; field?: string } | undefined;
const str = (form: FormData, k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string) : "");
const fields = (form: FormData) => Object.fromEntries([...form.keys()].map((k) => [k, str(form, k)]));
const to = (path: string, key: "notice" | "error", message: string) => `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(message)}`;
const idOf = (form: FormData, k = "id") => {
  const v = str(form, k);
  if (!UUID.test(v)) throw new ValidationError("Not found.");
  return v;
};
const failure = (e: unknown) => {
  if (e instanceof ValidationError) return e.message;
  console.error(`compliance action failed: ${sanitizeError(e, 200)}`);
  const m = e instanceof Error ? e.message : "";
  if (/relation|schema cache|does not exist/i.test(m)) return "The Compliance Center isn't installed yet. Apply the compliance migration first.";
  if (/COMPLIANCE_RECORD_KEPT/.test(m)) return "Attestations, acknowledgments and the history are kept and can't be changed.";
  return "That did not work. Nothing was changed. Please try again.";
};

async function session() {
  const office = await requireOffice();
  return { office, ctx: ctxFor(office), deps: complianceDeps(office.tenantId) };
}

/** Runs an action, then returns to `back` with a notice; a problem is shown in the form, which keeps what was typed. */
async function act(back: string | ((s: Awaited<ReturnType<typeof session>>) => string), fn: (s: Awaited<ReturnType<typeof session>>) => Promise<string | { to: string; notice: string }>): Promise<FormResult> {
  let target: string;
  try {
    const s = await session();
    const r = await fn(s);
    const path = typeof r === "string" ? (typeof back === "string" ? back : back(s)) : r.to;
    target = to(path, "notice", typeof r === "string" ? r : r.notice);
  } catch (e) {
    unstable_rethrow(e);
    return { error: failure(e) };
  }
  revalidatePath("/office", "layout");
  redirect(target);
}

// ------------------------------------------------------------------ WISP

export async function buildWispAction(form: FormData): Promise<FormResult> {
  return act("/office/compliance/wisp", async ({ ctx, deps, office }) => {
    const answers = Object.fromEntries(ALL_FIELDS.map((f) => [f.id, str(form, f.id)]));
    const doc = await buildWisp(deps, ctx, answers, await brandName(office.tenantId));
    return { to: `/office/compliance/wisp?built=${doc.id}`, notice: "Your WISP was built and saved in the vault. Read it, then attest below." };
  });
}

export async function attestAction(form: FormData): Promise<FormResult> {
  return act("/office/compliance/wisp", async ({ ctx, deps }) => {
    const a = await attest(deps, ctx, { documentId: str(form, "document_id"), name: str(form, "name"), confirm: str(form, "confirm") });
    return `Attested. The next review is due ${a.review_due}. Your team can now acknowledge the WISP.`;
  });
}

export async function acknowledgeAction(form: FormData): Promise<FormResult> {
  return act(() => (str(form, "back").startsWith("/office/") ? str(form, "back") : "/office/compliance"), async ({ ctx, deps }) => {
    await acknowledge(deps, ctx, idOf(form, "attestation_id"));
    return "Thank you. Your acknowledgment is recorded.";
  });
}

// ------------------------------------------------------------------ vault uploads

export type UploadTicket = { ok: true; id: string; uploadUrl: string; contentType: string } | { ok: false; error: string };

export async function startUploadAction(input: { kind: string; title: string; fileName: string; sizeBytes: number }): Promise<UploadTicket> {
  try {
    const { ctx, deps } = await session();
    const t = await startUpload(deps, ctx, input);
    return { ok: true, id: t.doc.id, uploadUrl: t.uploadUrl, contentType: t.contentType };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: failure(e) };
  }
}

export async function finishUploadAction(id: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    if (!UUID.test(id)) throw new ValidationError("Not found.");
    const { ctx, deps } = await session();
    const doc = await finishUpload(deps, ctx, id);
    revalidatePath("/office", "layout");
    return { ok: true, id: doc.id };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: failure(e) };
  }
}

export async function deleteDocumentAction(form: FormData): Promise<FormResult> {
  return act("/office/compliance/vault", async ({ ctx, deps }) => {
    const r = await deleteDocument(deps, ctx, idOf(form), { reason: str(form, "reason") });
    return r.early ? `Deleted before the end of its retention period. Your reason is kept in the history. ${DELETE_NOTICE}` : deletedNotice("Document");
  });
}

// ------------------------------------------------------------------ 8879

export async function create8879Action(form: FormData): Promise<FormResult> {
  return act("/office/compliance/8879", async ({ ctx, deps }) => {
    const r = await create8879(deps, ctx, fields(form));
    return `Recorded. Keep it until ${r.retention_until}.`;
  });
}

export async function update8879Action(form: FormData): Promise<FormResult> {
  const id = str(form, "id");
  return act(`/office/compliance/8879/${UUID.test(id) ? id : ""}`, async ({ ctx, deps }) => {
    const r = await update8879(deps, ctx, idOf(form), fields(form));
    return `Saved. Keep it until ${r.retention_until}.`;
  });
}

export async function delete8879Action(form: FormData): Promise<FormResult> {
  return act("/office/compliance/8879", async ({ ctx, deps }) => {
    const r = await delete8879(deps, ctx, idOf(form), { reason: str(form, "reason") });
    return r.early ? "Record deleted before the end of its retention period. Your reason is kept in the history. The vault file, if any, is still in the vault." : "Record deleted. The vault file, if any, is still in the vault.";
  });
}

// ------------------------------------------------------------------ PTIN

export async function renewalAction(form: FormData): Promise<FormResult> {
  return act(() => (str(form, "back").startsWith("/office/") ? str(form, "back") : "/office/compliance/ptin"), async ({ ctx, deps }) => {
    const r = await recordRenewal(deps, ctx, { memberId: str(form, "member_id"), renewed: str(form, "renewed"), renewedOn: str(form, "renewed_on") });
    return r.renewed ? `Recorded: renewed for ${r.renewal_year}.` : `Recorded: not renewed for ${r.renewal_year} yet.`;
  });
}

// ------------------------------------------------------------------ incidents

export async function startIncidentAction(form: FormData): Promise<FormResult> {
  return act("/office/compliance", async ({ ctx, deps }) => {
    const inc = await startIncident(deps, ctx, fields(form));
    return { to: `/office/compliance/incidents/${inc.id}`, notice: "Incident reported. Your ERO has been told in the Compliance Center. Work through the checklist below." };
  });
}

export async function updateIncidentAction(form: FormData): Promise<FormResult> {
  const id = str(form, "id");
  return act(`/office/compliance/incidents/${UUID.test(id) ? id : ""}`, async ({ ctx, deps }) => {
    await updateIncident(deps, ctx, idOf(form), fields(form));
    return "Saved.";
  });
}

export async function stepAction(form: FormData): Promise<FormResult> {
  const id = str(form, "id");
  return act(`/office/compliance/incidents/${UUID.test(id) ? id : ""}`, async ({ ctx, deps }) => {
    await markStep(deps, ctx, idOf(form), { step: str(form, "step"), state: str(form, "state"), note: str(form, "note") });
    return "Checklist updated.";
  });
}

export async function closeIncidentAction(form: FormData): Promise<FormResult> {
  const id = str(form, "id");
  return act(`/office/compliance/incidents/${UUID.test(id) ? id : ""}`, async ({ ctx, deps }) => {
    await closeIncident(deps, ctx, idOf(form), { reason: str(form, "reason") });
    return "Incident closed.";
  });
}

export async function reopenIncidentAction(form: FormData): Promise<FormResult> {
  const id = str(form, "id");
  return act(`/office/compliance/incidents/${UUID.test(id) ? id : ""}`, async ({ ctx, deps }) => {
    await reopenIncident(deps, ctx, idOf(form));
    return "Incident reopened.";
  });
}

// ------------------------------------------------------------------ office checklist and settings

export async function createItemAction(form: FormData): Promise<FormResult> {
  return act("/office/compliance/items", async ({ ctx, deps }) => {
    await createItem(deps, ctx, fields(form));
    return "Added to your checklist.";
  });
}

export async function updateItemAction(form: FormData): Promise<FormResult> {
  return act("/office/compliance/items", async ({ ctx, deps }) => {
    await updateItem(deps, ctx, idOf(form), fields(form));
    return "Saved.";
  });
}

export async function itemDoneAction(form: FormData): Promise<FormResult> {
  return act("/office/compliance/items", async ({ ctx, deps }) => {
    const item = await setItemDone(deps, ctx, idOf(form), str(form, "done") === "yes");
    return item.done_at ? (item.repeat === "yearly" ? `Done. Next due ${item.due_on}.` : "Done.") : "Marked not done.";
  });
}

export async function deleteItemAction(form: FormData): Promise<FormResult> {
  return act("/office/compliance/items", async ({ ctx, deps }) => {
    await deleteItem(deps, ctx, idOf(form));
    return "Removed from your checklist.";
  });
}

export async function saveSettingsAction(form: FormData): Promise<FormResult> {
  return act("/office/compliance/settings", async ({ ctx, deps }) => {
    await saveSettings(deps, ctx, fields(form));
    return "Saved.";
  });
}
