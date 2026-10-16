import { tenantClient } from "@/lib/supabase/service";
import { isMediaPath, mediaType, tenantBucket } from "@/lib/storage/paths.ts";

// An account image (email image, form logo, product image), read from that tenant's own private bucket. Only image
// files under images/ are served; documents and uploads in other folders or buckets are never reachable here. Object
// names are random, so an address can't be guessed, and the bucket itself is never public or listable.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(_request: Request, { params }: { params: Promise<{ tenant: string; path: string[] }> }) {
  const { tenant, path: parts } = await params;
  const path = parts.join("/");
  const type = mediaType(path);
  if (!UUID.test(tenant) || !isMediaPath(path) || !type) return notFound();
  const { data, error } = await tenantClient(tenant).storage.from(tenantBucket(tenant)).download(path);
  if (error || !data) return notFound();
  return new Response(data.stream(), {
    headers: {
      "Content-Type": type,
      // Object names are never reused (a replaced image gets a new name), so the file can be cached for good.
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
