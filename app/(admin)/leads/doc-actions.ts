"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { leadDocLink } from "@/lib/leads/docs.ts";
import { leadDocsDeps } from "@/lib/leads/docs-server";

/** Opens one of a lead's documents: a one-minute download link. */
export async function downloadLeadDocAction(form: FormData) {
  await requireAdmin();
  const id = typeof form.get("id") === "string" ? (form.get("id") as string) : "";
  const raw = typeof form.get("back") === "string" ? (form.get("back") as string) : "";
  const back = /^\/(?!\/)[A-Za-z0-9\-._~/?#=&%]*$/.test(raw) ? raw : "/leads";
  let url: string;
  try {
    url = await leadDocLink(leadDocsDeps(), id);
  } catch (e) {
    unstable_rethrow(e);
    const message = e instanceof ValidationError ? e.message : "That document couldn't be opened. Please try again.";
    if (!(e instanceof ValidationError)) console.error(`lead document link failed: ${sanitizeError(e, 160)}`);
    redirect(`${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent(message)}`);
  }
  redirect(url);
}
