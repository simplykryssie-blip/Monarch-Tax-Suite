import { randomUUID } from "node:crypto";
import { ValidationError } from "../commerce/validation.ts";
import { type Block, isEmptyPage, sanitizeBlocks } from "./blocks.ts";
import { cleanPageSeo, cleanSiteSettings, SEO_LIMITS } from "./settings.ts";
import { cleanCustomHost, cleanLabel, labelFromName, platformDomain, subdomainHost } from "./domains.ts";

// A website for one office. Everything acts on the tenant the repository is built for; nothing here can name another.

export type Site = { id: string; tenant_id: string; name: string; slug: string; status: "draft" | "published"; published_at: string | null; created_at: string; /** The look and details, as a draft; see settings.ts. */ settings?: unknown; /** The copy visitors see. */ published_settings?: unknown | null };
export type SitePage = {
  id: string; tenant_id: string; site_id: string; slug: string; title: string; description: string | null; is_home: boolean; show_in_nav: boolean; position: number;
  draft: Block[]; published: Block[] | null; published_title: string | null; published_description: string | null; published_at: string | null; updated_at: string;
  /** Search details (see settings.ts): the draft and the copy visitors see. */
  seo?: unknown; published_seo?: unknown | null;
};
export type DomainDetail = { verification?: { type: string; domain: string; value: string; reason?: string }[]; misconfigured?: boolean; error?: string };
export type SiteDomain = { id: string; tenant_id: string; site_id: string; hostname: string; kind: "subdomain" | "custom"; status: "pending" | "active" | "error"; detail: DomainDetail; last_checked_at: string | null; created_at: string };

export interface SitesRepo {
  listSites(): Promise<Site[]>;
  getSite(id: string): Promise<Site | null>;
  insertSite(input: { name: string; slug: string; created_by: string | null }): Promise<Site>;
  updateSite(id: string, patch: Partial<Pick<Site, "name" | "slug" | "settings">>): Promise<Site>;
  removeSite(id: string): Promise<void>;
  listPages(siteId: string): Promise<SitePage[]>;
  getPage(id: string): Promise<SitePage | null>;
  insertPage(input: { site_id: string; slug: string; title: string; is_home: boolean; position: number }): Promise<SitePage>;
  updatePage(id: string, patch: Partial<Pick<SitePage, "title" | "description" | "show_in_nav" | "position" | "draft" | "slug" | "seo">>): Promise<SitePage>;
  removePage(id: string): Promise<void>;
  listDomains(siteId: string): Promise<SiteDomain[]>;
  getDomain(id: string): Promise<SiteDomain | null>;
  insertDomain(input: { site_id: string; hostname: string; kind: "subdomain" | "custom"; status: SiteDomain["status"]; detail: DomainDetail; created_by: string | null }): Promise<SiteDomain>;
  updateDomain(id: string, patch: Partial<Pick<SiteDomain, "hostname" | "status" | "detail" | "last_checked_at">>): Promise<SiteDomain>;
  removeDomain(id: string): Promise<void>;
  /** Whether any office in the platform already uses this hostname (a platform-level check; the answer is only yes or no). */
  hostnameTaken(host: string): Promise<boolean>;
  publish(siteId: string): Promise<number>;
  unpublish(siteId: string): Promise<void>;
}

/** What is asked of the hosting platform for custom domains. Null in deps when it isn't configured. */
export interface DomainsPort {
  add(host: string): Promise<{ verified: boolean; verification: NonNullable<DomainDetail["verification"]> }>;
  check(host: string): Promise<{ verified: boolean; verification: NonNullable<DomainDetail["verification"]>; misconfigured: boolean } | null>;
  remove(host: string): Promise<void>;
}

export type SitesDeps = { repo: SitesRepo; domains: DomainsPort | null; platform?: string; now?: () => Date; newId?: () => string };
const nowOf = (d: SitesDeps) => (d.now ? d.now() : new Date());
const platformOf = (d: SitesDeps) => d.platform ?? platformDomain();
const fail = (m: string): never => { throw new ValidationError(m); };
const isDuplicate = (e: unknown) => /duplicate key|unique constraint|already exists/i.test(e instanceof Error ? e.message : "");

export const MAX_PAGES = 20;
export const MAX_CUSTOM_DOMAINS = 3;
const PAGE_SLUG = /^[a-z0-9]([a-z0-9-]{0,58}[a-z0-9])?$/;
const cleanText = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");

// ------------------------------------------------------------------ site

export const MAX_SITES = 10;

/** A new website: a blank home page and its own free address, taken from the name. */
export async function createSite(deps: SitesDeps, input: { name: string; userId: string | null }): Promise<Site> {
  if ((await deps.repo.listSites()).length >= MAX_SITES) fail(`A workspace can have up to ${MAX_SITES} websites.`);
  const name = cleanText(input.name, 120);
  if (!name) fail("Give the website a name.");
  const base = (() => { try { return cleanLabel(labelFromName(name)); } catch { return `office-${(deps.newId ?? randomUUID)().slice(0, 6)}`; } })();
  let site: Site | null = null;
  for (let i = 0; i < 12 && !site; i++) {
    const label = i === 0 ? base : `${base.slice(0, 36)}-${i + 1}`;
    try {
      cleanLabel(label);
      site = await deps.repo.insertSite({ name, slug: label, created_by: input.userId });
    } catch (e) {
      if (!isDuplicate(e) && !(e instanceof ValidationError)) throw e;
      if (i === 11) throw new ValidationError("A web address couldn't be chosen automatically. Try a different name, then change it under Addresses.");
    }
  }
  const made = site!;
  await deps.repo.insertDomain({ site_id: made.id, hostname: subdomainHost(made.slug, platformOf(deps)), kind: "subdomain", status: "active", detail: {}, created_by: input.userId });
  await deps.repo.insertPage({ site_id: made.id, slug: "", title: "Home", is_home: true, position: 0 });
  return made;
}

export async function renameSite(deps: SitesDeps, siteId: string, raw: unknown): Promise<Site> {
  const name = cleanText(raw, 120);
  if (!name) fail("Give the website a name.");
  if (!(await deps.repo.getSite(siteId))) fail("That website wasn't found.");
  return deps.repo.updateSite(siteId, { name });
}

/** Saves a website's look and details (colors, fonts, header, footer, contact, hours, social, search). Visitors see them after it is published. */
export async function saveSiteSettings(deps: SitesDeps, siteId: string, raw: unknown): Promise<Site> {
  if (!(await deps.repo.getSite(siteId))) fail("That website wasn't found.");
  return deps.repo.updateSite(siteId, { settings: cleanSiteSettings(raw) });
}

/** Deletes a website: its pages and addresses go with it, and any address of your own is released at the website host. */
export async function deleteSite(deps: SitesDeps, siteId: string): Promise<void> {
  if (!(await deps.repo.getSite(siteId))) fail("That website wasn't found.");
  for (const d of await deps.repo.listDomains(siteId)) {
    if (d.kind === "custom" && deps.domains) await deps.domains.remove(d.hostname).catch(() => undefined);
  }
  await deps.repo.removeSite(siteId);
}

// ----------------------------------------------------------------- pages

export async function addPage(deps: SitesDeps, siteId: string, raw: { title?: unknown; slug?: unknown }): Promise<SitePage> {
  const title = cleanText(raw.title, 120);
  if (!title) fail("Give the page a title.");
  const pages = await deps.repo.listPages(siteId);
  if (pages.length >= MAX_PAGES) fail(`A site can have at most ${MAX_PAGES} pages.`);
  const slug = (typeof raw.slug === "string" && raw.slug.trim() ? raw.slug : title).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/g, "");
  if (!slug || !PAGE_SLUG.test(slug)) fail("Use letters and numbers for the page address.");
  if (pages.some((p) => p.slug === slug)) fail("A page with that address already exists.");
  return deps.repo.insertPage({ site_id: siteId, slug, title, is_home: false, position: pages.reduce((n, p) => Math.max(n, p.position), 0) + 1 });
}

export async function savePage(deps: SitesDeps, pageId: string, raw: { title?: unknown; description?: unknown; show_in_nav?: unknown; blocks?: unknown; seo?: unknown }): Promise<SitePage> {
  const page = (await deps.repo.getPage(pageId)) ?? fail("That page wasn't found.");
  const title = cleanText(raw.title, 120);
  if (!title) fail("Give the page a title.");
  let blocks: Block[];
  try {
    blocks = sanitizeBlocks(typeof raw.blocks === "string" ? JSON.parse(raw.blocks) : raw.blocks);
  } catch (e) {
    if (e instanceof ValidationError) throw e;
    throw new ValidationError("The page content wasn't understood. Reload the page and try again.");
  }
  return deps.repo.updatePage(page!.id, {
    title, description: cleanText(raw.description, SEO_LIMITS.description) || null, draft: blocks, seo: cleanPageSeo(raw.seo),
    show_in_nav: page!.is_home ? true : raw.show_in_nav === true || raw.show_in_nav === "on" || raw.show_in_nav === "1",
  });
}

export async function removePage(deps: SitesDeps, pageId: string): Promise<void> {
  const page = (await deps.repo.getPage(pageId)) ?? fail("That page wasn't found.");
  if (page!.is_home) fail("The home page can't be removed.");
  await deps.repo.removePage(page!.id);
}

/** Moves a page one place earlier or later in the menu. The home page always stays first. */
export async function movePage(deps: SitesDeps, siteId: string, pageId: string, direction: "up" | "down"): Promise<void> {
  const pages = (await deps.repo.listPages(siteId)).sort((a, b) => a.position - b.position);
  const i = pages.findIndex((p) => p.id === pageId);
  if (i < 0) fail("That page wasn't found.");
  const j = direction === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= pages.length || pages[i].is_home || pages[j].is_home) return;
  const [aId, bId, aPos, bPos] = [pages[i].id, pages[j].id, pages[i].position, pages[j].position];
  await deps.repo.updatePage(aId, { position: bPos === aPos ? bPos + (direction === "up" ? -1 : 1) : bPos });
  await deps.repo.updatePage(bId, { position: aPos });
}

// -------------------------------------------------------------- publishing

/** Publishes every page's draft. The home page must have something on it. */
export async function publishSite(deps: SitesDeps, siteId: string): Promise<number> {
  const pages = await deps.repo.listPages(siteId);
  const home = pages.find((p) => p.is_home);
  if (!home || isEmptyPage(home.draft)) fail("Add something to the home page before publishing.");
  return deps.repo.publish(siteId);
}
export async function unpublishSite(deps: SitesDeps, siteId: string): Promise<void> {
  await deps.repo.unpublish(siteId);
}

/** Pages whose draft differs from what visitors see. */
export const hasUnpublishedChanges = (pages: SitePage[], site?: Pick<Site, "settings" | "published_settings">) =>
  pages.some((p) => p.published === null || JSON.stringify(p.published) !== JSON.stringify(p.draft) || p.published_title !== p.title || (p.published_description ?? null) !== (p.description ?? null)
    || JSON.stringify(cleanPageSeo(p.published_seo ?? {})) !== JSON.stringify(cleanPageSeo(p.seo ?? {})))
  || (site !== undefined && site.published_settings !== null && site.published_settings !== undefined && JSON.stringify(cleanSiteSettings(site.published_settings)) !== JSON.stringify(cleanSiteSettings(site.settings ?? {})));

// ----------------------------------------------------------------- domains

/** Changes the default address label. The old address stops answering at once. */
export async function setSubdomain(deps: SitesDeps, site: Site, domains: SiteDomain[], raw: unknown): Promise<Site> {
  const label = cleanLabel(raw);
  const sub = domains.find((d) => d.kind === "subdomain");
  if (label === site.slug) {
    // Same name, but the stored address may be on an older platform domain: bring it up to date.
    const want = subdomainHost(label, platformOf(deps));
    if (sub && sub.hostname !== want) await deps.repo.updateDomain(sub.id, { hostname: want });
    return site;
  }
  try {
    const updated = await deps.repo.updateSite(site.id, { slug: label });
    if (sub) await deps.repo.updateDomain(sub.id, { hostname: subdomainHost(label, platformOf(deps)) });
    return updated;
  } catch (e) {
    if (isDuplicate(e)) fail("That address is taken. Choose another.");
    throw e;
  }
}

export async function addCustomDomain(deps: SitesDeps, site: Site, domains: SiteDomain[], raw: unknown, userId: string | null): Promise<SiteDomain> {
  const host = cleanCustomHost(raw, platformOf(deps));
  if (!deps.domains) fail("Custom domains aren't turned on for this deployment yet. Ask the platform administrator to add the website hosting settings.");
  if (domains.filter((d) => d.kind === "custom").length >= MAX_CUSTOM_DOMAINS) fail(`A site can have at most ${MAX_CUSTOM_DOMAINS} custom domains.`);
  if (domains.some((d) => d.hostname === host)) fail("That domain is already connected to your site.");
  // Checked before the hosting side is touched: removing a domain another office uses would take their site down.
  if (await deps.repo.hostnameTaken(host)) fail("That domain is already connected to a website.");
  let added: Awaited<ReturnType<DomainsPort["add"]>>;
  try {
    added = await deps.domains!.add(host);
  } catch (e) {
    if (e instanceof ValidationError) throw e;
    console.error(`sites: could not add domain: ${e instanceof Error ? e.message.slice(0, 160) : "unknown"}`);
    throw new ValidationError("The website host couldn't add that domain. Check the spelling and try again.");
  }
  try {
    return await deps.repo.insertDomain({ site_id: site.id, hostname: host, kind: "custom", status: "pending", detail: { verification: added.verification }, created_by: userId });
  } catch (e) {
    // Lost a race with another office connecting it at the same moment. The hosting side is left alone on purpose.
    if (isDuplicate(e)) fail("That domain is already connected to a website.");
    throw e;
  }
}

/** Re-reads the domain's state at the hosting platform; it goes live once the DNS records are right. */
export async function refreshDomain(deps: SitesDeps, domainId: string): Promise<SiteDomain> {
  const d = (await deps.repo.getDomain(domainId)) ?? fail("That domain wasn't found.");
  if (d!.kind !== "custom") return d!;
  if (!deps.domains) fail("Custom domains aren't turned on for this deployment yet.");
  const state = await deps.domains!.check(d!.hostname);
  const at = nowOf(deps).toISOString();
  if (!state) return deps.repo.updateDomain(d!.id, { status: "error", detail: { error: "The website host doesn't know this domain any more. Remove it and add it again." }, last_checked_at: at });
  const live = state.verified && !state.misconfigured;
  return deps.repo.updateDomain(d!.id, { status: live ? "active" : "pending", detail: { verification: state.verified ? [] : state.verification, misconfigured: state.misconfigured }, last_checked_at: at });
}

export async function removeDomain(deps: SitesDeps, domainId: string): Promise<void> {
  const d = (await deps.repo.getDomain(domainId)) ?? fail("That domain wasn't found.");
  if (d!.kind === "subdomain") fail("The default address can be changed but not removed.");
  if (deps.domains) await deps.domains.remove(d!.hostname).catch((e) => { throw new ValidationError(e instanceof ValidationError ? e.message : "The website host couldn't remove that domain. Try again."); });
  await deps.repo.removeDomain(d!.id);
}
