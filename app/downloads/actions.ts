"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { productFilesDeps } from "@/lib/admin";
import { filesForLicense, issueDownload } from "@/lib/commerce/product-files.ts";
import { clientAddress, hashClient, windowStart } from "@/lib/commerce/rate-limit.ts";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { rateLimitStore } from "@/lib/rate-limit-server";

export type DownloadsState = { error?: string; product?: string; files?: { id: string; name: string; size: number }[] };

const text = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" ? v.trim().slice(0, 64) : "";
};

/** License keys are guessed one request at a time, so lookups are limited per visitor. */
async function client(): Promise<string | null> {
  const ip = clientAddress((await headers()).get("x-forwarded-for"));
  if (!ip) return null;
  const id = hashClient(ip, process.env.MONARCH_ENCRYPTION_KEY);
  const hits = await rateLimitStore().hit(`downloads:ip:${id}`, windowStart(Date.now()).startIso).catch(() => 0);
  if (hits > 20) throw new ValidationError("Too many attempts. Please wait a minute and try again.");
  return id;
}

/** Lists the files a license holder may download. */
export async function listDownloadsAction(_prev: DownloadsState, form: FormData): Promise<DownloadsState> {
  try {
    await client();
    const { product, files } = await filesForLicense(productFilesDeps(), text(form, "license_key"));
    return { product: product.name, files: files.map((f) => ({ id: f.id, name: f.file_name, size: f.size_bytes })) };
  } catch (e) {
    if (e instanceof ValidationError) return { error: e.message };
    console.error(`downloads lookup failed: ${e instanceof Error ? e.message.slice(0, 160) : "unknown"}`);
    return { error: "Downloads are temporarily unavailable. Please try again later." };
  }
}

/** One file: re-checks the license, logs the download and sends the browser to a 60-second signed download URL. */
export async function downloadFileAction(form: FormData) {
  let url: string;
  try {
    const clientHash = await client();
    url = await issueDownload(productFilesDeps(), { rawKey: text(form, "license_key"), fileId: text(form, "file_id"), clientHash });
  } catch (e) {
    const message = e instanceof ValidationError ? e.message : "Downloads are temporarily unavailable. Please try again later.";
    if (!(e instanceof ValidationError)) console.error(`download failed: ${e instanceof Error ? e.message.slice(0, 160) : "unknown"}`);
    redirect(`/downloads?error=${encodeURIComponent(message)}`);
  }
  redirect(url);
}
