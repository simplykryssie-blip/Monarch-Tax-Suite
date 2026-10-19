import "server-only";
import { requireAdmin } from "../admin";
import { loadBrand } from "../branding/server";
import { requirePractice } from "../practice/server";
import { currentTenantId } from "../tenants.ts";
import { sitesDeps } from "./server";
import { ensureSite, type Site, type SitesDeps } from "./service.ts";

// Who is editing a website and for which office. The editor appears in two places: the main workspace (the Monarch
// account) and an independent PTIN holder's workspace. Each area proves who is signed in; everything after that acts as
// that area's tenant only.

export type SitesArea = "admin" | "practice";
export type SitesContext = { area: SitesArea; base: string; tenantId: string; userId: string; name: string; deps: SitesDeps; site: Site };

export const isSitesArea = (v: unknown): v is SitesArea => v === "admin" || v === "practice";

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
  const deps = sitesDeps(tenantId);
  const site = await ensureSite(deps, { name, userId });
  return { area, base, tenantId, userId, name, deps, site };
}
