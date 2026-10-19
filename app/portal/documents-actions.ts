"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { finishPortalUpload, portalDocLink, startPortalUpload } from "@/lib/portal/documents.ts";
import { portalDocDeps, requirePortal } from "@/lib/portal/server";

// Document center actions for a signed-in client. Each one re-checks who is signed in and acts only on that client of
// the office they have open.

const fail = (e: unknown) => {
  if (e instanceof ValidationError) return e.message;
  console.error(`portal document action failed: ${sanitizeError(e, 200)}`);
  return "That did not work. Nothing was changed. Please try again.";
};
export type Ticket = { ok: true; id: string; uploadUrl: string; contentType: string } | { ok: false; error: string };

export async function startPortalUploadAction(input: { fileName: string; sizeBytes: number; title?: string; requestId?: string }): Promise<Ticket> {
  const ctx = await requirePortal();
  try {
    const t = await startPortalUpload(portalDocDeps(ctx.tenantId, ctx.clientId), input, ctx.userId);
    return { ok: true, id: t.doc.id, uploadUrl: t.uploadUrl, contentType: t.contentType };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: fail(e) };
  }
}

export async function finishPortalUploadAction(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requirePortal();
  try {
    await finishPortalUpload(portalDocDeps(ctx.tenantId, ctx.clientId), id);
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: fail(e) };
  }
}

export async function openPortalDocAction(form: FormData) {
  const ctx = await requirePortal();
  let url: string;
  try {
    url = await portalDocLink(portalDocDeps(ctx.tenantId, ctx.clientId), String(form.get("id") ?? ""));
  } catch (e) {
    unstable_rethrow(e);
    redirect(`/portal/documents?error=${encodeURIComponent(fail(e))}`);
  }
  redirect(url);
}
