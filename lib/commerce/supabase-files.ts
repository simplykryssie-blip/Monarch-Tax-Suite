import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { unwrap } from "./supabase-repo.ts";
import { discardObjects, removeObjects } from "../storage/objects.ts";
import { STORED_CONTENT_TYPE, type DownloadEvent, type FileStore, type ProductFile, type ProductFilesRepo } from "./product-files.ts";

export const PRODUCT_FILE_BUCKET = "product-files";

/** product_files and download_events; service-role client only (server-side). */
export class SupabaseProductFilesRepo implements ProductFilesRepo {
  constructor(private db: SupabaseClient) {}
  async insertFile(input: Pick<ProductFile, "product_id" | "storage_path" | "file_name" | "size_bytes" | "created_by">) {
    return unwrap(await this.db.from("product_files").insert(input).select("*").single()) as ProductFile;
  }
  async getFile(id: string) {
    return unwrap(await this.db.from("product_files").select("*").eq("id", id).maybeSingle()) as ProductFile | null;
  }
  async updateFile(id: string, patch: Partial<ProductFile>) {
    return unwrap(await this.db.from("product_files").update(patch).eq("id", id).select("*").single()) as ProductFile;
  }
  async listFiles(productId: string) {
    return unwrap(await this.db.from("product_files").select("*").eq("product_id", productId).neq("status", "removed").order("created_at", { ascending: true })) as ProductFile[];
  }
  async addDownload(input: Omit<DownloadEvent, "id" | "created_at">) {
    return unwrap(await this.db.from("download_events").insert(input).select("*").single()) as DownloadEvent;
  }
  async listDownloads(filter: { licenseId?: string; productId?: string }, limit: number) {
    let q = this.db.from("download_events").select("*").order("created_at", { ascending: false }).limit(limit);
    if (filter.licenseId) q = q.eq("license_id", filter.licenseId);
    if (filter.productId) q = q.eq("product_id", filter.productId);
    return unwrap(await q) as DownloadEvent[];
  }
}

/** The private product-files bucket. Nothing in it is ever public. */
export class SupabaseFileStore implements FileStore {
  constructor(private db: SupabaseClient) {}
  private bucket() { return this.db.storage.from(PRODUCT_FILE_BUCKET); }
  async createUploadUrl(path: string) {
    const { data, error } = await this.bucket().createSignedUploadUrl(path, { upsert: false });
    if (error || !data) throw new Error(`Could not prepare the upload: ${error?.message ?? "no URL"}`);
    return { url: data.signedUrl };
  }
  async stat(path: string) {
    const { data, error } = await this.bucket().info(path);
    if (error || !data) return null;
    return { size: data.size ?? 0, contentType: data.contentType ?? null };
  }
  async signedDownloadUrl(path: string, fileName: string, seconds: number) {
    // `download` makes Storage answer with Content-Disposition: attachment, so the browser saves the file.
    const { data, error } = await this.bucket().createSignedUrl(path, seconds, { download: fileName });
    if (error || !data) throw new Error(`Could not sign the download: ${error?.message ?? "no URL"}`);
    return data.signedUrl;
  }
  /** Deletes the files; if storage can't be reached they are queued and the scheduler removes them later. */
  async remove(paths: string[]) {
    await removeObjects(this.db, PRODUCT_FILE_BUCKET, paths);
  }
  async discard(paths: string[]) {
    await discardObjects(this.db, PRODUCT_FILE_BUCKET, paths);
  }
}

export { STORED_CONTENT_TYPE };
