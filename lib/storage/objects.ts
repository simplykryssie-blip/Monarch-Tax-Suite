import type { SupabaseClient } from "@supabase/supabase-js";
import { sanitizeError } from "../automation/sanitize.ts";
import { tenantBucket } from "./paths.ts";

// Removing stored files. A file is removed together with its record; if storage can't be reached at that moment the
// file is written to storage_cleanup (on the tenant client, so it is filed under the tenant) and the scheduler removes
// it later. Nothing is left behind in a bucket.

/** Removes objects from a bucket. On failure the paths are queued for the scheduler, then the error is thrown. */
export async function removeObjects(db: SupabaseClient, bucket: string, paths: string[]): Promise<void> {
  const list = [...new Set(paths.filter(Boolean))];
  if (!list.length) return;
  let message: string | null = null;
  try {
    const { error } = await db.storage.from(bucket).remove(list);
    if (error) message = error.message;
  } catch (e) {
    message = sanitizeError(e, 200);
  }
  if (message === null) return;
  await queueRemoval(db, bucket, list, message);
  throw new Error(`File removal failed: ${message}`);
}

async function queueRemoval(db: SupabaseClient, bucket: string, paths: string[], error: string) {
  const { error: e } = await db.from("storage_cleanup").upsert(paths.map((path) => ({ bucket, path, last_error: error.slice(0, 300), updated_at: new Date().toISOString() })), { onConflict: "tenant_id,bucket,path" });
  if (e) console.error(`storage-cleanup: could not queue ${paths.length} file(s) in ${bucket}: ${sanitizeError(e.message, 160)}`);
}

type Queued = { id: string; bucket: string; path: string; attempts: number };

/** Retries queued removals for this tenant. Returns how many files were removed. */
export async function sweepStorageCleanup(db: SupabaseClient, limit = 100): Promise<{ removed: number; failed: number }> {
  const { data, error } = await db.from("storage_cleanup").select("id, bucket, path, attempts").order("created_at").limit(limit);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Queued[];
  let removed = 0;
  let failed = 0;
  const byBucket = new Map<string, Queued[]>();
  for (const r of rows) byBucket.set(r.bucket, [...(byBucket.get(r.bucket) ?? []), r]);
  for (const [bucket, items] of byBucket) {
    const { error: e } = await db.storage.from(bucket).remove(items.map((i) => i.path));
    if (!e) {
      await db.from("storage_cleanup").delete().in("id", items.map((i) => i.id));
      removed += items.length;
    } else {
      failed += items.length;
      for (const i of items) await db.from("storage_cleanup").update({ attempts: i.attempts + 1, last_error: e.message.slice(0, 300), updated_at: new Date().toISOString() }).eq("id", i.id);
    }
  }
  return { removed, failed };
}

/** Uploads to the tenant's own bucket, making the bucket first if this tenant doesn't have one yet. */
export async function uploadToTenantBucket(db: SupabaseClient, tenantId: string, path: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const bucket = tenantBucket(tenantId);
  const put = () => db.storage.from(bucket).upload(path, bytes, { contentType, upsert: false, cacheControl: "31536000" });
  let { error } = await put();
  if (error && /bucket not found|not found/i.test(error.message)) {
    const made = await db.storage.createBucket(bucket, { public: false, fileSizeLimit: 4 * 1024 * 1024, allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"] });
    if (made.error && !/already exists/i.test(made.error.message)) throw new Error(`Could not set up this account's storage: ${made.error.message}`);
    ({ error } = await put());
  }
  if (error) throw new Error(`Image upload failed: ${error.message}`);
}
