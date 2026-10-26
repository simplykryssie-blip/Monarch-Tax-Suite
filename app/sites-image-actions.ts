"use server";

import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { SupabaseImageStore } from "@/lib/commerce/supabase-repo.ts";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { uploadLibraryImage } from "@/lib/images/service.ts";
import { SupabaseImagesRepo } from "@/lib/images/supabase-repo";
import { isSitesArea, requireSite } from "@/lib/sites/context";
import { tenantClient } from "@/lib/supabase/service";

// A picture for a website page: stored in the office's own private image library and shown through /media. It is added
// without leaving the page editor, so nothing typed there is lost.

export type SiteImageResult = { ok: true; image: { id: string; label: string; url: string } } | { ok: false; error: string };

export async function uploadSiteImageAction(form: FormData): Promise<SiteImageResult> {
  const area = String(form.get("area") ?? "");
  if (!isSitesArea(area)) return { ok: false, error: "Sign in again to upload." };
  const ctx = await requireSite(area, String(form.get("site_id") ?? ""));
  try {
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new ValidationError("Choose a picture to upload.");
    const db = tenantClient(ctx.tenantId);
    const row = await uploadLibraryImage(new SupabaseImagesRepo(db), new SupabaseImageStore(db, ctx.tenantId, ""), { bytes: new Uint8Array(await file.arrayBuffer()), declaredType: file.type, fileName: file.name, altText: String(form.get("alt") ?? "") }, ctx.userId);
    return { ok: true, image: { id: row.id, label: row.alt_text || row.file_name, url: `/media/${ctx.tenantId}/${row.storage_path}` } };
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    console.error(`site image upload failed: ${sanitizeError(e, 200)}`);
    return { ok: false, error: "The picture could not be uploaded. Please try again." };
  }
}
