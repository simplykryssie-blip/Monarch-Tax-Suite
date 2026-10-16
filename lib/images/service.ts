import { randomUUID } from "node:crypto";
import { validateImage } from "../commerce/images.ts";
import type { ImageStore } from "../commerce/types.ts";
import { ValidationError } from "../commerce/validation.ts";
import { MEDIA_EXT } from "../storage/paths.ts";

// The account's image library: pictures uploaded for emails. Each file is kept in the account's own private bucket
// under images/library/ and shown through /media. Deleting an image deletes its file from storage as well.

export type TenantImage = {
  id: string; tenant_id: string; storage_path: string; content_type: "image/jpeg" | "image/png" | "image/webp"; size_bytes: number;
  width: number | null; height: number | null; file_name: string; alt_text: string | null; created_by: string | null; created_at: string;
};
export type NewTenantImage = Omit<TenantImage, "id" | "tenant_id" | "created_at">;
export interface ImagesRepo {
  list(limit: number): Promise<TenantImage[]>;
  get(id: string): Promise<TenantImage | null>;
  insert(input: NewTenantImage): Promise<TenantImage>;
  remove(id: string): Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cleanName = (raw: string) => (raw.split(/[\\/]/).pop() ?? "").normalize("NFKC").replace(/[^\w .-]+/g, "_").trim().slice(-200) || "image";
const cleanAlt = (raw: string | null | undefined) => (typeof raw === "string" ? raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200) : "") || null;

/** Checks the file is a real JPEG, PNG or WebP of at most 4 MB, stores it, and records it. */
export async function uploadLibraryImage(repo: ImagesRepo, store: ImageStore, input: { bytes: Uint8Array; declaredType: string; fileName: string; altText?: string | null }, actorId: string): Promise<TenantImage> {
  const { type, width, height } = validateImage({ bytes: input.bytes, declaredType: input.declaredType, fileName: input.fileName, altText: null });
  const path = `images/library/${randomUUID()}.${MEDIA_EXT[type]}`;
  await store.put(path, input.bytes, type);
  try {
    return await repo.insert({ storage_path: path, content_type: type, size_bytes: input.bytes.byteLength, width, height, file_name: cleanName(input.fileName), alt_text: cleanAlt(input.altText), created_by: actorId });
  } catch (e) {
    await store.remove([path]).catch(() => undefined);
    throw e;
  }
}

/** Deletes the image and its file. An email already sent that showed it will show a blank space instead. */
export async function deleteLibraryImage(repo: ImagesRepo, store: ImageStore, id: string): Promise<void> {
  const image = UUID.test(id) ? await repo.get(id) : null;
  if (!image) throw new ValidationError("That image wasn't found.");
  await repo.remove(image.id);
  // If storage can't be reached now, the file is queued and the scheduler deletes it.
  await store.remove([image.storage_path]).catch(() => undefined);
}

/** The Markdown that puts this picture in an email template. */
export const emailMarkdown = (url: string, alt: string | null) => `![${(alt ?? "").replace(/[\]\n]/g, " ")}](${url})`;
