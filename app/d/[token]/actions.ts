"use server";

import { redirect } from "next/navigation";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { linkContext, visitor } from "@/lib/documents/public";
import { downloadFromLink } from "@/lib/documents/service.ts";

const TOKEN = /^[A-Za-z0-9_-]{40,60}$/;

/** Checks the link again on every click, records the download, and sends the browser to a 60-second file link. */
export async function downloadDocumentAction(form: FormData) {
  const token = String(form.get("token") ?? "");
  if (!TOKEN.test(token)) redirect("/");
  let target: string;
  try {
    await visitor(30);
    const ctx = await linkContext(token);
    if (!ctx) throw new ValidationError("This link is not valid.");
    target = await downloadFromLink(ctx.deps, token);
  } catch (e) {
    const message = e instanceof ValidationError ? e.message : "The download is temporarily unavailable. Please try again.";
    if (!(e instanceof ValidationError)) console.error(`document download failed: ${e instanceof Error ? e.message.slice(0, 160) : "unknown"}`);
    target = `/d/${token}?error=${encodeURIComponent(message)}`;
  }
  redirect(target);
}
