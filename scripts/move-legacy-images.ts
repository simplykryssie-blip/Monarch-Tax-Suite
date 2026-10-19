// One-time move of images uploaded before per-tenant buckets (the shared, public product-images bucket) into each
// tenant's own private bucket, tenant-{tenant_id}. Run it after migration 20261031100000_tenant_storage_and_sending.
//
//   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... APP_ORIGIN=https://your-app.example \
//     node scripts/move-legacy-images.ts            # shows what it would do
//     node scripts/move-legacy-images.ts --apply    # does it
//
// Product images: each file is copied to images/products/... in its tenant's bucket, the row is pointed at the new
// path, then the old file is deleted. Form logos and header images: copied to images/forms/..., the form's look is
// pointed at the /media address, then the old file is deleted. Safe to run again: moved images are skipped.
// Run it on the test project first.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
const origin = (process.env.APP_ORIGIN ?? "").replace(/\/$/, "");
const apply = process.argv.includes("--apply");
if (!url || !key || !/^https:\/\//.test(origin)) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and APP_ORIGIN (https://...).");
  process.exit(1);
}

const LEGACY = "product-images";
const platform = createClient(url, key, { auth: { persistSession: false } });
const asTenant = (tenant: string) => createClient(url, key, { auth: { persistSession: false }, global: { headers: { "x-tenant-id": tenant } } });
const bucketOf = (tenant: string) => `tenant-${tenant}`;
const TYPE: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

async function copy(db: SupabaseClient, tenant: string, from: string, to: string) {
  const { data, error } = await platform.storage.from(LEGACY).download(from);
  if (error || !data) throw new Error(`download ${from}: ${error?.message ?? "missing"}`);
  const up = await db.storage.from(bucketOf(tenant)).upload(to, new Uint8Array(await data.arrayBuffer()), { contentType: TYPE[to.split(".").pop()!] ?? "image/png", upsert: true, cacheControl: "31536000" });
  if (up.error) throw new Error(`upload ${to}: ${up.error.message}`);
}

const { data: tenants, error } = await platform.from("tenants").select("id, name");
if (error) throw new Error(error.message);
let moved = 0;
for (const t of tenants as { id: string; name: string }[]) {
  const db = asTenant(t.id);
  const { error: b } = await db.storage.getBucket(bucketOf(t.id));
  if (b) throw new Error(`${t.name}: bucket ${bucketOf(t.id)} is missing. Apply the migration first.`);

  const { data: images, error: e1 } = await db.from("product_images").select("id, storage_path").like("storage_path", "products/%");
  if (e1) throw new Error(e1.message);
  for (const img of images as { id: string; storage_path: string }[]) {
    const to = `images/${img.storage_path}`;
    console.log(`${t.name}: product image ${img.storage_path} -> ${bucketOf(t.id)}/${to}`);
    if (!apply) continue;
    await copy(db, t.id, img.storage_path, to);
    const u = await db.from("product_images").update({ storage_path: to }).eq("id", img.id);
    if (u.error) throw new Error(u.error.message);
    await platform.storage.from(LEGACY).remove([img.storage_path]);
    moved++;
  }

  const { data: forms, error: e2 } = await db.from("forms").select("id, settings");
  if (e2) throw new Error(e2.message);
  for (const f of forms as { id: string; settings: Record<string, unknown> | null }[]) {
    const theme = (f.settings?.theme ?? null) as Record<string, unknown> | null;
    if (!theme) continue;
    const next = { ...theme };
    const old: string[] = [];
    for (const field of ["logo_url", "header_image_url"]) {
      const v = typeof theme[field] === "string" ? (theme[field] as string) : "";
      const m = /\/storage\/v1\/object\/public\/product-images\/(forms\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:jpg|png|webp))$/.exec(v);
      if (!m) continue;
      const to = `images/${m[1]}`;
      console.log(`${t.name}: form image ${m[1]} -> ${bucketOf(t.id)}/${to}`);
      if (!apply) continue;
      await copy(db, t.id, m[1], to);
      next[field] = `${origin}/media/${t.id}/${to}`;
      old.push(m[1]);
    }
    if (!apply || !old.length) continue;
    const u = await db.from("forms").update({ settings: { ...f.settings, theme: next } }).eq("id", f.id);
    if (u.error) throw new Error(u.error.message);
    await platform.storage.from(LEGACY).remove(old);
    moved += old.length;
  }
}
console.log(apply ? `Moved ${moved} image(s).` : "Dry run. Nothing was changed. Run again with --apply to move them.");
