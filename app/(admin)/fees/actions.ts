"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { MAX_CSV_BYTES } from "@/lib/fees/csv.ts";
import { feesDeps } from "@/lib/fees/server";
import {
  addLine, archiveReturn, importBank, importReturns, linkReceipt, loadTemplate, markPaid, previewFile, reapplyFees, recordReturn, removeLine,
  restoreReturn, setOverride, updateLine, updateReturn, type BankResult, type ImportResult, type LineForm, type ReturnForm,
} from "@/lib/fees/service.ts";
import type { Mapping } from "@/lib/fees/types.ts";

// Fees & Statements actions. Every action re-checks administrator access and acts only on the current tenant's rows
// (the tenant-scoped database client), so ids from another tenant are simply not found.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const str = (form: FormData, k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string) : "");
const idOf = (form: FormData, k = "id") => {
  const v = str(form, k);
  if (!UUID.test(v)) throw new ValidationError("Not found.");
  return v;
};
const optionalId = (form: FormData, k: string) => {
  const v = str(form, k);
  if (!v) return null;
  if (!UUID.test(v)) throw new ValidationError("Not found.");
  return v;
};
const withParam = (path: string, key: "notice" | "error", message: string) => `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(message)}`;
const safeBack = (form: FormData, fallback: string) => {
  const b = str(form, "back");
  return b.startsWith("/fees") && !b.startsWith("//") ? b : fallback;
};

const failure = (e: unknown) => {
  if (e instanceof ValidationError) return e.message;
  console.error(`fees action failed: ${sanitizeError(e, 200)}`);
  const m = e instanceof Error ? e.message : "";
  if (/relation|schema cache|does not exist/i.test(m)) return "Fees & Statements is not installed yet. Apply the fees migration first.";
  if (/FEE_RECEIPT_KEPT/.test(m)) return "Recorded payments and bank amounts can't be changed.";
  if (/FEE_NOT_A_BANK/.test(m)) return "Choose a bank product from Software & banking.";
  if (/duplicate key|unique/i.test(m)) return "That already exists. Reload the page and check.";
  return "That did not work. Nothing was changed. Please try again.";
};

type FormResult = { error: string; field?: string } | undefined;

/** On success: redirect with a notice. On a problem: return the message, so the form keeps what was typed. */
async function act(back: string, fn: (adminId: string) => Promise<{ to?: string; notice: string }>): Promise<FormResult> {
  const admin = await requireAdmin();
  let target: string;
  try {
    const r = await fn(admin.userId);
    target = withParam(r.to ?? back, "notice", r.notice);
  } catch (e) {
    return { error: failure(e) };
  }
  revalidatePath("/fees", "layout");
  redirect(target);
}

const lineForm = (form: FormData): LineForm => ({
  label: str(form, "label"), amount: str(form, "amount"), applies: str(form, "applies"), bankId: optionalId(form, "bank_id"),
  sortOrder: str(form, "sort_order") ? Number(str(form, "sort_order")) || 0 : undefined,
});
const returnForm = (form: FormData): ReturnForm => ({
  officeId: str(form, "office_id"), taxYear: str(form, "tax_year"), returnRef: str(form, "return_ref"), taxpayerName: str(form, "taxpayer_name"),
  bankId: optionalId(form, "bank_id"), filedOn: str(form, "filed_on"), fundedOn: str(form, "funded_on"), notes: str(form, "notes"),
});

export async function loadTemplateAction(form: FormData): Promise<FormResult> {
  return act(safeBack(form, "/fees/schedule"), async (a) => { await loadTemplate(feesDeps(), a); return { notice: "Monarch's template is loaded. Edit any amount to match your pricing." }; });
}
export async function addLineAction(form: FormData): Promise<FormResult> {
  const officeId = optionalId(form, "office_id");
  return act(safeBack(form, "/fees/schedule"), async (a) => { const l = await addLine(feesDeps(), a, lineForm(form), officeId); return { notice: `"${l.label}" added.` }; });
}
export async function updateLineAction(form: FormData): Promise<FormResult> {
  return act(safeBack(form, "/fees/schedule"), async (a) => { const l = await updateLine(feesDeps(), a, idOf(form), lineForm(form)); return { notice: `"${l.label}" saved. Returns already recorded keep their fees.` }; });
}
export async function removeLineAction(form: FormData): Promise<FormResult> {
  return act(safeBack(form, "/fees/schedule"), async (a) => { await removeLine(feesDeps(), a, idOf(form)); return { notice: "Fee line removed. Returns already recorded keep their fees." }; });
}
export async function setOverrideAction(form: FormData): Promise<FormResult> {
  const officeId = idOf(form, "office_id");
  const clear = str(form, "clear") === "yes";
  return act(safeBack(form, `/fees/offices/${officeId}`), async (a) => {
    await setOverride(feesDeps(), a, officeId, str(form, "code"), clear ? null : str(form, "amount"));
    return { notice: clear ? "Back to the bureau amount." : "This office's amount is saved. It applies to returns recorded from now on." };
  });
}

export async function recordReturnAction(form: FormData): Promise<FormResult> {
  const input = returnForm(form);
  return act(safeBack(form, `/fees/offices/${input.officeId}`), async (a) => { const r = await recordReturn(feesDeps(), a, input); return { notice: `Return ${r.return_ref} recorded and charged.` }; });
}
export async function updateReturnAction(form: FormData): Promise<FormResult> {
  const id = idOf(form);
  return act(`/fees/returns/${id}`, async (a) => { await updateReturn(feesDeps(), a, id, returnForm(form)); return { notice: "Return saved." }; });
}
export async function reapplyFeesAction(form: FormData): Promise<FormResult> {
  const id = idOf(form);
  return act(`/fees/returns/${id}`, async (a) => { await reapplyFees(feesDeps(), a, id, str(form, "reason")); return { notice: "Fees re-applied from the current schedule." }; });
}
export async function markPaidAction(form: FormData): Promise<FormResult> {
  const id = idOf(form);
  return act(safeBack(form, `/fees/returns/${id}`), async (a) => {
    await markPaid(feesDeps(), a, id, { amount: str(form, "amount"), date: str(form, "date"), reference: str(form, "reference"), note: str(form, "note") });
    return { notice: "Payment recorded." };
  });
}
export async function archiveReturnAction(form: FormData): Promise<FormResult> {
  const id = idOf(form);
  return act(`/fees/returns/${id}`, async (a) => { await archiveReturn(feesDeps(), a, id, str(form, "reason")); return { notice: "Return archived. It's left out of statements." }; });
}
export async function restoreReturnAction(form: FormData): Promise<FormResult> {
  const id = idOf(form);
  return act(`/fees/returns/${id}`, async (a) => { await restoreReturn(feesDeps(), a, id); return { notice: "Return restored." }; });
}
export async function linkReceiptAction(form: FormData): Promise<FormResult> {
  const id = idOf(form);
  return act("/fees/bank", async (a) => {
    await linkReceipt(feesDeps(), a, id, { officeId: idOf(form, "office_id"), returnRef: str(form, "return_ref"), taxYear: str(form, "tax_year") });
    return { notice: "Bank row linked to the return." };
  });
}

// The import screens read the file in the browser and send its text here, so nothing is stored until it's imported.

type Preview = { ok: true; headers: string[]; sample: string[][]; rowCount: number; mapping: Mapping } | { ok: false; error: string };
export async function previewImportAction(kind: "returns" | "bank", text: string): Promise<Preview> {
  await requireAdmin();
  try {
    if (typeof text !== "string" || text.length > MAX_CSV_BYTES) throw new ValidationError("That file is too large. Split it into files under 2 MB.");
    return { ok: true, ...(await previewFile(feesDeps(), kind === "bank" ? "bank" : "returns", text)) };
  } catch (e) {
    return { ok: false, error: failure(e) };
  }
}

const cleanMapping = (m: unknown): Mapping => Object.fromEntries(Object.entries((m && typeof m === "object" ? m : {}) as Record<string, unknown>).filter(([k, v]) => /^[a-z_]{1,30}$/.test(k) && typeof v === "string" && v.length <= 200).map(([k, v]) => [k, v as string]));

export async function importReturnsAction(input: { officeId: string; taxYear: string; text: string; mapping: Mapping }): Promise<{ ok: true; result: ImportResult } | { ok: false; error: string }> {
  const admin = await requireAdmin();
  try {
    if (!UUID.test(input.officeId)) throw new ValidationError("Choose the office these returns belong to.");
    const result = await importReturns(feesDeps(), admin.userId, { officeId: input.officeId, taxYear: String(input.taxYear), text: String(input.text), mapping: cleanMapping(input.mapping) });
    revalidatePath("/fees", "layout");
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: failure(e) };
  }
}

export async function importBankAction(input: { bankId: string; fileName: string; text: string; mapping: Mapping }): Promise<{ ok: true; result: BankResult } | { ok: false; error: string }> {
  const admin = await requireAdmin();
  try {
    if (!UUID.test(input.bankId)) throw new ValidationError("Choose the bank this file came from.");
    const result = await importBank(feesDeps(), admin.userId, { bankId: input.bankId, fileName: String(input.fileName ?? ""), text: String(input.text), mapping: cleanMapping(input.mapping) });
    revalidatePath("/fees", "layout");
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: failure(e) };
  }
}
