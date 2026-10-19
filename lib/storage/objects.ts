import type { SupabaseClient } from "@supabase/supabase-js";
import { sanitizeError } from "../automation/sanitize.ts";
import { tenantBucket } from "./paths.ts";
import { purgeAfter } from "./window.ts";

// Removing stored files, through one queue: storage_cleanup (on the tenant client, so rows are filed under the tenant).
// - scheduleRemoval: a person deleted it. The file is queued with purge_after = now + 24 hours (lib/storage/window.ts)
//   and the scheduler deletes it then.
// - removeObjects: system clean-up, deleted at once. If storage can't be reached, the file is queued for the next
//   sweep. Either way nothing is left behind in a bucket.

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
  const now = new Date().toISOString();
  const { error: e } = await db.from("storage_cleanup").upsert(paths.map((path) => ({ bucket, path, purge_after: now, last_error: error.slice(0, 300), updated_at: now })), { onConflict: "tenant_id,bucket,path" });
  if (e) console.error(`storage-cleanup: could not queue ${paths.length} file(s) in ${bucket}: ${sanitizeError(e.message, 160)}`);
}

/**
 * A person deleted these files: they are permanently deleted from storage after the 24-hour window, by the scheduler.
 * Throws if they can't be queued, so the caller never reports a delete whose files would be left behind.
 */
export async function scheduleRemoval(db: SupabaseClient, bucket: string, paths: string[], now = new Date()): Promise<void> {
  const list = [...new Set(paths.filter(Boolean))];
  if (!list.length) return;
  const at = now.toISOString();
  const { error } = await db.from("storage_cleanup").upsert(list.map((path) => ({ bucket, path, purge_after: purgeAfter(now).toISOString(), last_error: null, updated_at: at })), { onConflict: "tenant_id,bucket,path" });
  if (error) throw new Error(`Could not schedule the file for deletion: ${error.message}`);
}

type Queued = { id: string; bucket: string; path: string; attempts: number };

/** Deletes this tenant's queued files whose time has come. Returns how many were deleted. */
export async function sweepStorageCleanup(db: SupabaseClient, limit = 100, now = new Date()): Promise<{ removed: number; failed: number }> {
  const { data, error } = await db.from("storage_cleanup").select("id, bucket, path, attempts").lte("purge_after", now.toISOString()).order("purge_after").limit(limit);
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

/**
 * A person deleted these files: queue them for the 24-hour window. If they can't be queued, they are deleted at once
 * instead (and queued for the next sweep if storage is down too), so a deleted record never leaves its file behind.
 */
export async function discardObjects(db: SupabaseClient, bucket: string, paths: string[]): Promise<void> {
  try {
    await scheduleRemoval(db, bucket, paths);
  } catch (e) {
    console.error(`storage-cleanup: could not schedule ${paths.length} file(s) in ${bucket}, deleting now: ${sanitizeError(e, 160)}`);
    await removeObjects(db, bucket, paths);
  }
}
