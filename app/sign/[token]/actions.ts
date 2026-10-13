"use server";

import { redirect } from "next/navigation";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { linkAutomation, linkContext, visitor } from "@/lib/documents/public";
import { afterDeclined, afterSigned } from "@/lib/documents/notify.ts";
import { MAX_SIGNATURE_PNG_BYTES } from "@/lib/documents/signing.ts";
import { declineSignature, downloadFromLink, signDocument } from "@/lib/documents/service.ts";

export type SignState = { error?: string };
const TOKEN = /^[A-Za-z0-9_-]{40,60}$/;
const str = (form: FormData, k: string, max: number) => (typeof form.get(k) === "string" ? (form.get(k) as string).slice(0, max) : "");

function pngFromDataUrl(v: string): Uint8Array | null {
  const m = v.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  const bytes = Buffer.from(m[1], "base64");
  return bytes.byteLength <= MAX_SIGNATURE_PNG_BYTES ? new Uint8Array(bytes) : null;
}

const fail = (e: unknown, what: string): SignState => {
  if (e instanceof ValidationError) return { error: e.message };
  console.error(`signature ${what} failed: ${e instanceof Error ? e.message.slice(0, 160) : "unknown"}`);
  return { error: "Something went wrong and nothing was signed. Please try again in a few minutes." };
};

export async function signAction(_prev: SignState, form: FormData): Promise<SignState> {
  const token = str(form, "token", 80);
  if (!TOKEN.test(token)) return { error: "This link is not valid." };
  try {
    const who = await visitor(20);
    const ctx = await linkContext(token);
    if (!ctx) return { error: "This link is not valid." };
    const method = str(form, "method", 10) === "drawn" ? "drawn" : "typed";
    let mark: { method: "typed"; text: string } | { method: "drawn"; png: Uint8Array };
    if (method === "drawn") {
      const png = pngFromDataUrl(str(form, "drawn", 500_000));
      if (!png) return { error: "Draw your signature in the box, or type it instead." };
      mark = { method: "drawn", png };
    } else {
      mark = { method: "typed", text: str(form, "typed", 120) };
    }
    const outcome = await signDocument(ctx.deps, token, {
      consent: form.get("consent") === "yes", signedName: str(form, "signed_name", 200), mark, ipHash: who.ipHash, userAgent: who.userAgent,
      firmName: ctx.profile?.display_name ?? "the sender", timeZone: ctx.profile?.time_zone ?? "America/New_York",
    });
    await afterSigned(linkAutomation(ctx.tenantId), ctx.deps, outcome).catch((e) => console.error(`signature follow-up failed: ${e instanceof Error ? e.message.slice(0, 160) : "unknown"}`));
  } catch (e) {
    return fail(e, "sign");
  }
  redirect(`/sign/${token}?done=signed`);
}

export async function declineAction(_prev: SignState, form: FormData): Promise<SignState> {
  const token = str(form, "token", 80);
  if (!TOKEN.test(token)) return { error: "This link is not valid." };
  try {
    await visitor(20);
    const ctx = await linkContext(token);
    if (!ctx) return { error: "This link is not valid." };
    const outcome = await declineSignature(ctx.deps, token, str(form, "reason", 1000));
    await afterDeclined(linkAutomation(ctx.tenantId), ctx.deps, outcome).catch((e) => console.error(`decline follow-up failed: ${e instanceof Error ? e.message.slice(0, 160) : "unknown"}`));
  } catch (e) {
    return fail(e, "decline");
  }
  redirect(`/sign/${token}?done=declined`);
}

export async function downloadSignedAction(form: FormData) {
  const token = str(form, "token", 80);
  if (!TOKEN.test(token)) redirect("/");
  let target: string;
  try {
    await visitor(30);
    const ctx = await linkContext(token);
    if (!ctx) throw new ValidationError("This link is not valid.");
    target = await downloadFromLink(ctx.deps, token);
  } catch (e) {
    target = `/sign/${token}?error=${encodeURIComponent(e instanceof ValidationError ? e.message : "The download is temporarily unavailable.")}`;
  }
  redirect(target);
}
