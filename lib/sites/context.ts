import "server-only";
import { notFound } from "next/navigation";
import { requireAdmin } from "../admin";
import { loadBrand } from "../branding/server";
import { requirePractice } from "../practice/server";
import { currentTenantId } from "../tenants.ts";
import { sitesDeps } from "./server";
import type { Site, SitesDeps } from "./service.ts";

// Who is editing websites and for which office. The editor appears in two places: the main workspace (the Monarch
// account) and an independent PTIN holder's workspace. Each area proves who is signed in; everything after that acts as
// that area's tenant only.

export type SitesArea = "admin" | "practice";
/** `base` is the area's Websites page; one website lives at `${base}/${siteId}`. */
export type SitesContext = { area: SitesArea; base: string; tenantId: string; userId: string; name: string; deps: SitesDeps };
/** The same, for one website of that office. */
export type SiteContext = SitesContext & { site: Site; siteBase: string };

export const isSitesArea = (v: unknown): v is SitesArea => v === "admin" || v === "practice";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function requireSites(area: SitesArea): Promise<SitesContext> {
  let tenantId: string, userId: string, name: string, base: string;
  if (area === "admin") {
    const admin = await requireAdmin();
    tenantId = currentTenantId();
    userId = admin.userId;
    name = (await loadBrand(tenantId)).name;
    base = "/sites";
  } else {
    const p = await requirePractice();
    tenantId = p.tenantId;
    userId = p.userId;
    name = p.workspace;
    base = "/practice/website";
  }
  return { area, base, tenantId, userId, name, deps: sitesDeps(tenantId) };
}

/** One of the office's websites. An id that isn't this office's website is simply not found. */
export async function requireSite(area: SitesArea, siteId: string): Promise<SiteContext> {
  const ctx = await requireSites(area);
  const site = UUID.test(siteId) ? await ctx.deps.repo.getSite(siteId) : null;
  if (!site) notFound();
  return { ...ctx, site, siteBase: `${ctx.base}/${site.id}` };
}
