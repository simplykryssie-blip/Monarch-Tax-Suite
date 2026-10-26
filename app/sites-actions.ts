"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { isSitesArea, requireSite, requireSites, type SiteContext, type SitesContext } from "@/lib/sites/context";
import { addCustomDomain, addPage, createSite, deleteSite, movePage, publishSite, refreshDomain, removeDomain, removePage, renameSite, savePage, saveSiteSettings, setSubdomain, unpublishSite } from "@/lib/sites/service.ts";

// Website editor actions, for the main workspace and the PTIN workspace alike. Each one re-checks who is signed in and acts
// only on that area's office; ids from the form are looked up through the office's own rows, so another office's website,
// page or domain is simply not found.

const str = (form: FormData, k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string) : "");
const to = (path: string, key: "notice" | "error", message: string) => `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(message)}`;
const failure = (e: unknown) => {
  if (e instanceof ValidationError) return e.message;
  console.error(`sites action failed: ${sanitizeError(e, 200)}`);
  if (/relation|schema cache|does not exist|column/i.test(e instanceof Error ? e.message : "")) return "Websites need their latest database update. Apply it first.";
  return "That did not work. Nothing was changed. Please try again.";
};

/** An action on one website: `page` is where to come back to, below that website's address. */
async function run(form: FormData, page: string, fn: (ctx: SiteContext) => Promise<{ notice: string; to?: string }>) {
  const area = str(form, "area");
  if (!isSitesArea(area)) redirect("/");
  const ctx = await requireSite(area, str(form, "site_id"));
  const home = `${ctx.siteBase}${page}`;
  let target: string;
  try {
    const r = await fn(ctx);
    target = to(r.to ?? home, "notice", r.notice);
  } catch (e) {
    unstable_rethrow(e);
    target = to(home, "error", failure(e));
  }
  revalidatePath(ctx.base, "layout");
  redirect(target);
}

/** An action on the list of websites. */
async function runList(form: FormData, fn: (ctx: SitesContext) => Promise<{ notice: string; to?: string }>) {
  const area = str(form, "area");
  if (!isSitesArea(area)) redirect("/");
  const ctx = await requireSites(area);
  let target: string;
  try {
    const r = await fn(ctx);
    target = to(r.to ?? ctx.base, "notice", r.notice);
  } catch (e) {
    unstable_rethrow(e);
    target = to(ctx.base, "error", failure(e));
  }
  revalidatePath(ctx.base, "layout");
  redirect(target);
}

export async function createSiteAction(form: FormData) {
  await runList(form, async (ctx) => {
    const site = await createSite(ctx.deps, { name: str(form, "name"), userId: ctx.userId });
    return { notice: "Website created. Add content to its home page, then publish.", to: `${ctx.base}/${site.id}` };
  });
}

export async function deleteSiteAction(form: FormData) {
  await runList(form, async (ctx) => {
    if (str(form, "confirm").trim().toLowerCase() !== "delete") throw new ValidationError("Type DELETE to confirm.");
    await deleteSite(ctx.deps, str(form, "site_id"));
    return { notice: "Website deleted." };
  });
}

export async function renameSiteAction(form: FormData) {
  await run(form, "/settings", async (ctx) => {
    await renameSite(ctx.deps, ctx.site.id, form.get("name"));
    return { notice: "Renamed." };
  });
}

export async function saveSiteSettingsAction(form: FormData) {
  await run(form, "/settings", async (ctx) => {
    const raw = JSON.parse(str(form, "settings") || "{}");
    await saveSiteSettings(ctx.deps, ctx.site.id, raw);
    return { notice: "Saved. Publish the website to put the changes live." };
  });
}

export async function savePageAction(form: FormData) {
  const id = str(form, "page_id");
  await run(form, `/pages/${id}`, async (ctx) => {
    const page = await ctx.deps.repo.getPage(id);
    if (!page || page.site_id !== ctx.site.id) throw new ValidationError("That page wasn't found.");
    await savePage(ctx.deps, id, {
      title: form.get("title"), description: form.get("description"), show_in_nav: form.get("show_in_nav") === "on", blocks: form.get("blocks"),
      seo: { title: str(form, "seo_title"), shareImageId: str(form, "seo_image") || null, noindex: form.get("seo_noindex") === "on" },
    });
    return { notice: "Draft saved. Publish the website to put it live." };
  });
}

export async function addPageAction(form: FormData) {
  await run(form, "", async (ctx) => {
    const p = await addPage(ctx.deps, ctx.site.id, { title: form.get("title") });
    return { notice: "Page added.", to: `${ctx.siteBase}/pages/${p.id}` };
  });
}

export async function removePageAction(form: FormData) {
  await run(form, "", async (ctx) => {
    const page = await ctx.deps.repo.getPage(str(form, "page_id"));
    if (!page || page.site_id !== ctx.site.id) throw new ValidationError("That page wasn't found.");
    await removePage(ctx.deps, page.id);
    return { notice: "Page removed." };
  });
}

export async function movePageAction(form: FormData) {
  await run(form, "", async (ctx) => {
    await movePage(ctx.deps, ctx.site.id, str(form, "page_id"), str(form, "direction") === "up" ? "up" : "down");
    return { notice: "Menu order changed." };
  });
}

export async function publishAction(form: FormData) {
  await run(form, "", async (ctx) => {
    const n = await publishSite(ctx.deps, ctx.site.id);
    return { notice: `Published ${n} page${n === 1 ? "" : "s"}. Your website is live.` };
  });
}

export async function unpublishAction(form: FormData) {
  await run(form, "", async (ctx) => {
    await unpublishSite(ctx.deps, ctx.site.id);
    return { notice: "Your website is no longer public. Your pages are kept as drafts." };
  });
}

export async function setSubdomainAction(form: FormData) {
  await run(form, "/domains", async (ctx) => {
    await setSubdomain(ctx.deps, ctx.site, await ctx.deps.repo.listDomains(ctx.site.id), form.get("label"));
    return { notice: "Address changed. The old address no longer works." };
  });
}

export async function addDomainAction(form: FormData) {
  await run(form, "/domains", async (ctx) => {
    const d = await addCustomDomain(ctx.deps, ctx.site, await ctx.deps.repo.listDomains(ctx.site.id), form.get("host"), ctx.userId);
    return { notice: `${d.hostname} added. Add the records below at your domain provider, then check it.` };
  });
}

export async function refreshDomainAction(form: FormData) {
  await run(form, "/domains", async (ctx) => {
    const d = await refreshDomain(ctx.deps, str(form, "domain_id"));
    return { notice: d.status === "active" ? `${d.hostname} is connected and live.` : `${d.hostname} isn't connected yet. DNS changes can take a while; check again later.` };
  });
}

export async function removeDomainAction(form: FormData) {
  await run(form, "/domains", async (ctx) => {
    await removeDomain(ctx.deps, str(form, "domain_id"));
    return { notice: "Domain removed." };
  });
}
