"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { firstReturnStage, handoffMail, isArea, requirePrep, type PrepContext, type PrepFeature } from "@/lib/prep/server";
import {
  addChecklistItem, addMyClient, assignReturn, handOff, removeChecklistItem, savePrepNotes, saveMyClient, setChecklistDone, setPrepStatus, startReturn,
} from "@/lib/prep/service.ts";
import { importClients } from "@/lib/imports/service.ts";
import type { PrepStatus } from "@/lib/workspace/types.ts";

// Client intake and return-prep actions, shared by the PTIN holder's workspace and the office area. Each re-checks who
// is signed in and what they may reach (requirePrep), and acts only within that person's scope.

const str = (form: FormData, k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string) : "");
const raw = (form: FormData) => Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")) as Record<string, string>;
const to = (path: string, key: "notice" | "error", message: string) => `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(message)}`;
const STATUSES: PrepStatus[] = ["not_started", "in_prep", "ready_for_review", "handed_off"];

const failure = (e: unknown) => {
  if (e instanceof ValidationError) return e.message;
  console.error(`prep action failed: ${sanitizeError(e, 200)}`);
  if (/relation|schema cache|does not exist|column/i.test(e instanceof Error ? e.message : "")) return "Return preparation isn't installed yet. Apply the prep and assignment migration first.";
  return "That did not work. Nothing was changed. Please try again.";
};

/** `back` is a path inside the area (never an outside address). */
async function act(form: FormData, feature: PrepFeature, back: (ctx: PrepContext) => string, fn: (ctx: PrepContext) => Promise<{ to?: string; notice: string }>) {
  const area = str(form, "area");
  if (!isArea(area)) redirect("/login");
  const ctx = await requirePrep(area, feature);
  let target: string;
  try {
    const r = await fn(ctx);
    target = to(r.to ?? back(ctx), "notice", r.notice);
  } catch (e) {
    unstable_rethrow(e);
    target = to(back(ctx), "error", failure(e));
  }
  revalidatePath(ctx.base, "layout");
  redirect(target);
}

const clientPath = (ctx: PrepContext, id: string) => `${ctx.base}/clients/${id}`;
const returnPath = (ctx: PrepContext, id: string) => `${ctx.base}/prep/${id}`;

export async function addClientAction(form: FormData) {
  await act(form, "clients.intake", (c) => `${c.base}/clients`, async (ctx) => {
    const c = await addMyClient(ctx.deps, ctx.scope, raw(form));
    return { to: clientPath(ctx, c.id), notice: "Client added." };
  });
}

export async function saveClientAction(form: FormData) {
  const id = str(form, "id");
  await act(form, "clients.intake", (c) => clientPath(c, id), async (ctx) => {
    await saveMyClient(ctx.deps, ctx.scope, id, raw(form));
    return { notice: "Saved." };
  });
}

export async function startReturnAction(form: FormData) {
  const clientId = str(form, "client_id");
  await act(form, "returns.prep", (c) => clientPath(c, clientId), async (ctx) => {
    const r = await startReturn(ctx.deps, ctx.scope, raw(form), await firstReturnStage(ctx.tenantId));
    return { to: returnPath(ctx, r.id), notice: `Return started for ${r.tax_year}.` };
  });
}

export async function setStatusAction(form: FormData) {
  const id = str(form, "id");
  await act(form, "returns.prep", (c) => returnPath(c, id), async (ctx) => {
    const next = str(form, "status") as PrepStatus;
    if (!STATUSES.includes(next)) throw new ValidationError("Choose a status.");
    await setPrepStatus(ctx.deps, ctx.scope, id, next);
    return { notice: "Status updated." };
  });
}

export async function saveNotesAction(form: FormData) {
  const id = str(form, "id");
  await act(form, "returns.prep", (c) => returnPath(c, id), async (ctx) => {
    await savePrepNotes(ctx.deps, ctx.scope, id, form.get("notes"));
    return { notice: "Notes saved." };
  });
}

export async function addItemAction(form: FormData) {
  const id = str(form, "id");
  await act(form, "returns.prep", (c) => returnPath(c, id), async (ctx) => {
    await addChecklistItem(ctx.deps, ctx.scope, id, form.get("label"));
    return { notice: "Item added." };
  });
}

export async function toggleItemAction(form: FormData) {
  const id = str(form, "id");
  await act(form, "returns.prep", (c) => returnPath(c, id), async (ctx) => {
    await setChecklistDone(ctx.deps, ctx.scope, str(form, "item"), str(form, "done") === "yes");
    return { notice: "Saved." };
  });
}

export async function removeItemAction(form: FormData) {
  const id = str(form, "id");
  await act(form, "returns.prep", (c) => returnPath(c, id), async (ctx) => {
    await removeChecklistItem(ctx.deps, ctx.scope, str(form, "item"));
    return { notice: "Item removed." };
  });
}

export async function assignAction(form: FormData) {
  const id = str(form, "id");
  await act(form, "returns.prep", (c) => returnPath(c, id), async (ctx) => {
    await assignReturn(ctx.deps, ctx.scope, id, str(form, "assignee"), ctx.members.map((m) => m.id));
    return { notice: "Assigned." };
  });
}

export async function handOffAction(form: FormData) {
  const id = str(form, "id");
  await act(form, "returns.prep", (c) => returnPath(c, id), async (ctx) => {
    if (!ctx.canHandOff) throw new ValidationError("Handing a return to an outside ERO is for independent PTIN holders.");
    await handOff(ctx.deps, ctx.scope, id, form.get("to"), handoffMail(ctx));
    return { notice: "Sent. The return is now marked handed to the ERO and is locked here." };
  });
}

// ------------------------------------------------------------------ import clients from a spreadsheet

export type ImportClientsState =
  | undefined
  | { error: string }
  | {
      done: boolean; added: number; failed: number; total: number; willAdd: number;
      sample: { name: string; contact: string; tags: string[]; notes: string[] }[];
      skipped: { row: number; reason: string }[];
      columns: { used: string[]; sensitive: string[]; unknown: string[] };
    };

/** First call: shows what the file would do. With "confirm": does it. Imported people are never marked as agreeing to marketing. */
export async function importClientsAction(_prev: ImportClientsState, form: FormData): Promise<ImportClientsState> {
  const area = str(form, "area");
  if (!isArea(area)) redirect("/login");
  const ctx = await requirePrep(area, "clients.intake");
  try {
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV file to import." };
    const csv = await file.text();
    const r = await importClients(ctx.deps, ctx.scope, { csv, tag: str(form, "tag"), confirm: form.get("confirm") === "1" });
    if (r.done) revalidatePath(ctx.base, "layout");
    return {
      done: r.done, added: r.added, failed: r.failed, total: r.plan.total, willAdd: r.plan.add.length,
      sample: r.plan.add.slice(0, 8).map((p) => ({ name: p.full_name, contact: [p.email, p.phone].filter(Boolean).join(" · "), tags: p.tags, notes: p.notes })),
      skipped: r.plan.skipped.slice(0, 50), columns: r.plan.columns,
    };
  } catch (e) {
    unstable_rethrow(e);
    return { error: failure(e) };
  }
}
