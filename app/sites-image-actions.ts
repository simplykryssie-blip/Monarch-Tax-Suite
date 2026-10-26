"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { SupabaseImageStore } from "@/lib/commerce/supabase-repo.ts";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { uploadLibraryImage } from "@/lib/images/service.ts";
import { SupabaseImagesRepo } from "@/lib/images/supabase-repo";
import { isSitesArea, requireSite } from "@/lib/sites/context";
import { tenantClient } from "@/lib/supabase/service";

// A picture for a website page: stored in the office's own private image library and shown through /media.

export async function uploadSiteImageAction(form: FormData) {
  const area = String(form.get("area") ?? "");
  if (!isSitesArea(area)) redirect("/");
  const ctx = await requireSite(area, String(form.get("site_id") ?? ""));
  const pageId = String(form.get("page_id") ?? "");
  const back = `${ctx.siteBase}/pages/${pageId.replace(/[^0-9a-f-]/gi, "")}`;
  let target: string;
  try {
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new ValidationError("Choose a picture to upload.");
    const db = tenantClient(ctx.tenantId);
    await uploadLibraryImage(new SupabaseImagesRepo(db), new SupabaseImageStore(db, ctx.tenantId, ""), { bytes: new Uint8Array(await file.arrayBuffer()), declaredType: file.type, fileName: file.name, altText: String(form.get("alt") ?? "") }, ctx.userId);
    target = `${back}?notice=${encodeURIComponent("Picture uploaded. Choose it in an Image block.")}`;
  } catch (e) {
    unstable_rethrow(e);
    const message = e instanceof ValidationError ? e.message : (console.error(`site image upload failed: ${sanitizeError(e, 200)}`), "The picture could not be uploaded. Please try again.");
    target = `${back}?error=${encodeURIComponent(message)}`;
  }
  revalidatePath(ctx.base, "layout");
  redirect(target);
}
