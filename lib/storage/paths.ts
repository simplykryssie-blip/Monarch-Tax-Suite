// Where a tenant's images live and how they are addressed. Pure helpers (no server imports) so tests can use them.
//
// Every tenant has its own private bucket, tenant-{tenant_id} (migration 20261031090000_tenant_storage_and_sending).
// Images in it are kept under images/... and shown through the app at /media/{tenant_id}/images/..., which reads only
// image files, only from that tenant's bucket. Nothing else (documents, uploads) is ever served from /media.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Images uploaded before per-tenant buckets were in the shared public bucket; they are read from there until moved. */
export const LEGACY_IMAGE_BUCKET = "product-images";

export const MEDIA_TYPES = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" } as const;
export type MediaExt = keyof typeof MEDIA_TYPES;
export const MEDIA_EXT: Record<(typeof MEDIA_TYPES)[MediaExt], MediaExt> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** The tenant's own private bucket. */
export function tenantBucket(tenantId: string): string {
  if (!UUID.test(tenantId)) throw new Error("A tenant id is required for tenant storage.");
  return `tenant-${tenantId}`;
}

/** images/<lowercase segments>/<name>.<jpg|png|webp>, nothing that could climb out of the folder. */
const MEDIA_PATH = /^images\/(?:[a-z0-9-]{1,64}\/){0,4}[a-z0-9-]{1,64}\.(jpg|png|webp)$/;
export const isMediaPath = (path: string) => MEDIA_PATH.test(path);

/** The address an image in the tenant's bucket is shown at. `origin` "" gives a path for use inside the app. */
export function mediaUrl(origin: string, tenantId: string, path: string): string {
  if (!UUID.test(tenantId) || !isMediaPath(path)) throw new Error("Not a media path.");
  return `${origin.replace(/\/$/, "")}/media/${tenantId}/${path}`;
}

/** The image path inside this tenant's bucket that a /media address points at, or null when it is anything else. */
export function mediaPathFromUrl(url: string, tenantId: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(url, "https://x.invalid").pathname;
  } catch {
    return null;
  }
  const prefix = `/media/${tenantId}/`;
  if (!pathname.startsWith(prefix)) return null;
  const path = pathname.slice(prefix.length);
  return isMediaPath(path) ? path : null;
}

/** The object path of an image in the old shared public bucket, from its public address, or null. */
export function legacyPathFromUrl(url: string): string | null {
  const m = /\/storage\/v1\/object\/public\/product-images\/([A-Za-z0-9/._-]+)$/.exec(url.split("?")[0] ?? "");
  return m && !m[1].includes("..") ? m[1] : null;
}

/** The content type for a media path's extension. */
export const mediaType = (path: string) => MEDIA_TYPES[path.split(".").pop() as MediaExt] ?? null;
