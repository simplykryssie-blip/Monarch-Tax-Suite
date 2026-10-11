"use server";

import { revalidatePath } from "next/cache";
import { productFilesDeps, requireAdmin } from "@/lib/admin";
import { finishUpload, removeFile, startUpload } from "@/lib/commerce/product-files.ts";
import { ValidationError } from "@/lib/commerce/validation.ts";

// Product file uploads. The browser sends the file straight to private storage with a one-time URL (server actions
// are capped at 4.5 MB); these actions check the request first and confirm the stored object afterwards.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export type UploadTicket = { ok: true; fileId: string; uploadUrl: string; contentType: string } | { ok: false; error: string };
export type UploadResult = { ok: true; fileName: string } | { ok: false; error: string };

export async function startFileUploadAction(productId: string, fileName: string, sizeBytes: number): Promise<UploadTicket> {
  const admin = await requireAdmin();
  if (!UUID.test(productId)) return { ok: false, error: "Invalid product." };
  try {
    const { file, uploadUrl, contentType } = await startUpload(productFilesDeps(), { productId, fileName: String(fileName).slice(0, 300), sizeBytes: Number(sizeBytes), adminId: admin.userId });
    return { ok: true, fileId: file.id, uploadUrl, contentType };
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    console.error(`product file upload could not start: ${e instanceof Error ? e.message.slice(0, 160) : "unknown"}`);
    return { ok: false, error: "Uploads are not available. Check that the product files migration is applied." };
  }
}

export async function finishFileUploadAction(productId: string, fileId: string): Promise<UploadResult> {
  await requireAdmin();
  if (!UUID.test(productId) || !UUID.test(fileId)) return { ok: false, error: "Invalid upload." };
  try {
    const file = await finishUpload(productFilesDeps(), fileId);
    if (file.product_id !== productId) return { ok: false, error: "Invalid upload." };
    revalidatePath(`/products/${productId}`);
    return { ok: true, fileName: file.file_name };
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function removeFileAction(form: FormData) {
  await requireAdmin();
  const productId = String(form.get("product_id") ?? "");
  const fileId = String(form.get("file_id") ?? "");
  if (!UUID.test(productId) || !UUID.test(fileId)) return;
  const deps = productFilesDeps();
  const file = await deps.files.getFile(fileId);
  if (file?.product_id === productId) await removeFile(deps, fileId);
  revalidatePath(`/products/${productId}`);
}
