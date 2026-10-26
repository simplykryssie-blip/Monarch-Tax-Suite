import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, test } from "node:test";
import { googleFontsHref, settingsOf, cleanPageSeo, pageTitleFor, pageIsIndexed, DEFAULT_SETTINGS } from "../lib/sites/settings.ts";
import { addCustomDomain, addPage, createSite, deleteSite, saveSiteSettings, hasUnpublishedChanges, movePage, publishSite, refreshDomain, removeDomain, removePage, savePage, setSubdomain, type DomainsPort, type Site, type SiteDomain, type SitePage, type SitesDeps, type SitesRepo } from "../lib/sites/service.ts";
import { vercelDomains, vercelProblems } from "../lib/sites/vercel.ts";

// One shared "platform" so two offices can collide on addresses like they would in the database.
class Platform { slugs = new Set<string>(); hosts = new Set<string>(); }
class Repo implements SitesRepo {
  sites: Site[] = [];
  /** The first website, for tests about one. */
  get site(): Site | null { return this.sites[0] ?? null; }
  pages: SitePage[] = [];
  domains: SiteDomain[] = [];
  published = 0;
  platform: Platform;
  tenant: string;
  constructor(platform: Platform, tenant: string) { this.platform = platform; this.tenant = tenant; }
  async listSites() { return this.sites.slice(); }
  async getSite(id: string) { return this.sites.find((s) => s.id === id) ?? null; }
  async removeSite(id: string) {
    const s = this.sites.find((x) => x.id === id);
    if (s) this.platform.slugs.delete(s.slug);
    this.sites = this.sites.filter((x) => x.id !== id);
    this.pages = this.pages.filter((p) => p.site_id !== id);
    this.domains = this.domains.filter((d) => d.site_id !== id);
  }
  async insertSite(i: { name: string; slug: string; created_by: string | null }) {
    if (this.platform.slugs.has(i.slug)) throw new Error('duplicate key value violates unique constraint "sites_slug_key"');
    this.platform.slugs.add(i.slug);
    const site: Site = { id: randomUUID(), tenant_id: this.tenant, name: i.name, slug: i.slug, status: "draft", published_at: null, created_at: "", settings: {}, published_settings: null };
    this.sites.push(site);
    return site;
  }
  async updateSite(id: string, p: Partial<Pick<Site, "name" | "slug" | "settings">>) {
    const cur = this.sites.find((s) => s.id === id)!;
    if (p.slug && p.slug !== cur.slug && this.platform.slugs.has(p.slug)) throw new Error('duplicate key value violates unique constraint "sites_slug_key"');
    if (p.slug) { this.platform.slugs.delete(cur.slug); this.platform.slugs.add(p.slug); }
    Object.assign(cur, p);
    return cur;
  }
  async listPages(siteId: string) { return this.pages.filter((p) => p.site_id === siteId); }
  async getPage(id: string) { return this.pages.find((p) => p.id === id) ?? null; }
  async insertPage(i: { site_id: string; slug: string; title: string; is_home: boolean; position: number }) {
    const p: SitePage = { id: randomUUID(), tenant_id: this.tenant, description: null, show_in_nav: true, draft: [], published: null, published_title: null, published_description: null, published_at: null, updated_at: "", ...i };
    this.pages.push(p);
    return p;
  }
  async updatePage(id: string, patch: Partial<SitePage>) { const p = this.pages.find((x) => x.id === id)!; Object.assign(p, patch); return p; }
  async removePage(id: string) { this.pages = this.pages.filter((p) => p.id !== id); }
  async listDomains(siteId: string) { return this.domains.filter((d) => d.site_id === siteId); }
  async getDomain(id: string) { return this.domains.find((d) => d.id === id) ?? null; }
  async insertDomain(i: Omit<SiteDomain, "id" | "tenant_id" | "last_checked_at" | "created_at">) {
    if (this.platform.hosts.has(i.hostname)) throw new Error('duplicate key value violates unique constraint "site_domains_hostname_key"');
    this.platform.hosts.add(i.hostname);
    const d: SiteDomain = { id: randomUUID(), tenant_id: this.tenant, last_checked_at: null, created_at: "", ...i };
    this.domains.push(d);
    return d;
  }
  async updateDomain(id: string, patch: Partial<SiteDomain>) { const d = this.domains.find((x) => x.id === id)!; if (patch.hostname) { this.platform.hosts.delete(d.hostname); this.platform.hosts.add(patch.hostname); } Object.assign(d, patch); return d; }
  async removeDomain(id: string) { const d = this.domains.find((x) => x.id === id)!; this.platform.hosts.delete(d.hostname); this.domains = this.domains.filter((x) => x.id !== id); }
  async hostnameTaken(host: string) { return this.platform.hosts.has(host); }
  async publish(siteId: string) {
    const mine = this.pages.filter((p) => p.site_id === siteId);
    if (!mine.length) throw new Error("SITE_EMPTY");
    for (const p of mine) { p.published = p.draft; p.published_title = p.title; p.published_description = p.description; p.published_seo = p.seo; }
    this.site!.published_settings = this.site!.settings;
    this.published++;
    this.site!.status = "published";
    return mine.length;
  }
  async unpublish() { this.site!.status = "draft"; }
}
class FakeDomains implements DomainsPort {
  calls: string[] = [];
  verified = false;
  misconfigured = true;
  known = true;
  async add(h: string) { this.calls.push(`add:${h}`); return { verified: this.verified, verification: this.verified ? [] : [{ type: "TXT", domain: `_vercel.${h}`, value: "vc-verify-123" }] }; }
  async check(h: string) { this.calls.push(`check:${h}`); return this.known ? { verified: this.verified, verification: this.verified ? [] : [{ type: "TXT", domain: `_vercel.${h}`, value: "vc-verify-123" }], misconfigured: this.misconfigured } : null; }
  async remove(h: string) { this.calls.push(`remove:${h}`); }
}
function setup(platform = new Platform(), tenant = randomUUID(), domains: DomainsPort | null = new FakeDomains()) {
  const repo = new Repo(platform, tenant);
  const deps: SitesDeps = { repo, domains, platform: "monarchtaxsuite.com", now: () => new Date("2027-03-01T12:00:00Z") };
  return { repo, deps, platform };
}

describe("creating a website", () => {
  test("a blank home page and the default address", async () => {
    const { repo, deps } = setup();
    const site = await createSite(deps, { name: "Smith & Sons Tax", userId: "u1" });
    assert.equal(site.slug, "smith-sons-tax");
    assert.equal(repo.pages.length, 1);
    assert.deepEqual([repo.pages[0].slug, repo.pages[0].is_home, repo.pages[0].draft], ["", true, []]);
    assert.deepEqual(repo.domains.map((d) => [d.hostname, d.kind, d.status]), [["smith-sons-tax.monarchtaxsuite.com", "subdomain", "active"]]);
  });
  test("an office can have several websites, each with its own pages, address and settings", async () => {
    const { repo, deps } = setup();
    const a = await createSite(deps, { name: "Smith Tax", userId: "u1" });
    const b = await createSite(deps, { name: "Smith Bookkeeping", userId: "u1" });
    assert.notEqual(a.id, b.id);
    assert.equal(repo.pages.length, 2);
    assert.deepEqual((await repo.listSites()).map((s) => s.slug).sort(), ["smith-bookkeeping", "smith-tax"]);
    await saveSiteSettings(deps, b.id, { brand: { primary: "#112233" } });
    assert.equal(settingsOf((await repo.getSite(a.id))!.settings).brand.primary, null);
    assert.equal(settingsOf((await repo.getSite(b.id))!.settings).brand.primary, "#112233");
    await deleteSite(deps, b.id);
    assert.equal((await repo.listSites()).length, 1);
    assert.equal(repo.pages.length, 1);
  });
  test("at most ten websites", async () => {
    const { deps } = setup();
    for (let i = 0; i < 10; i++) await createSite(deps, { name: `Site ${i}`, userId: null });
    await assert.rejects(createSite(deps, { name: "One more", userId: null }), /up to/i);
  });
  test("two offices with the same name get different addresses", async () => {
    const platform = new Platform();
    const a = setup(platform);
    const b = setup(platform);
    const sa = await createSite(a.deps, { name: "Smith Tax", userId: null });
    const sb = await createSite(b.deps, { name: "Smith Tax", userId: null });
    assert.equal(sa.slug, "smith-tax");
    assert.equal(sb.slug, "smith-tax-2");
  });
  test("a name that would be a reserved address still gets one", async () => {
    const { deps } = setup();
    const site = await createSite(deps, { name: "Admin", userId: null });
    assert.notEqual(site.slug, "admin");
  });
});

describe("pages", () => {
  test("add, save with cleaned blocks, move, remove; the home page is protected", async () => {
    const { repo, deps } = setup();
    const site = await createSite(deps, { name: "Smith Tax", userId: null });
    const about = await addPage(deps, site.id, { title: "About Us" });
    assert.equal(about.slug, "about-us");
    await assert.rejects(addPage(deps, site.id, { title: "About us" }), /already exists/);
    await assert.rejects(addPage(deps, site.id, { title: " " }), /title/);
    const contact = await addPage(deps, site.id, { title: "Contact", slug: "Get In Touch" });
    assert.equal(contact.slug, "get-in-touch");
    const saved = await savePage(deps, about.id, { title: "About", description: "Who we are", show_in_nav: "on", blocks: JSON.stringify([{ type: "heading", text: "Hello" }, { type: "html", html: "<script>x</script>" }, { type: "button", label: "x", href: "javascript:1" }]) });
    assert.equal(saved.draft.length, 1);
    assert.equal(saved.published, null);
    await assert.rejects(savePage(deps, about.id, { title: "About", blocks: "{not json" }), /wasn't understood/);
    await assert.rejects(savePage(deps, about.id, { title: "", blocks: "[]" }), /title/);
    const home = repo.pages.find((p) => p.is_home)!;
    assert.equal((await savePage(deps, home.id, { title: "Home", show_in_nav: "", blocks: "[]" })).show_in_nav, true);
    await movePage(deps, site.id, contact.id, "up");
    assert.deepEqual((await repo.listPages(site.id)).sort((a, b) => a.position - b.position).map((p) => p.slug), ["", "get-in-touch", "about-us"]);
    await movePage(deps, site.id, contact.id, "up");
    assert.equal((await repo.listPages(site.id)).sort((a, b) => a.position - b.position)[0].slug, "", "the home page stays first");
    await assert.rejects(removePage(deps, home.id), /home page/);
    await removePage(deps, about.id);
    assert.equal((await repo.listPages(site.id)).length, 2);
  });
  test("at most 20 pages", async () => {
    const { deps } = setup();
    const site = await createSite(deps, { name: "Smith Tax", userId: null });
    for (let i = 0; i < 19; i++) await addPage(deps, site.id, { title: `Page ${i}` });
    await assert.rejects(addPage(deps, site.id, { title: "One more" }), /at most 20/);
  });
});

describe("publishing", () => {
  test("needs a home page with something on it; publishes drafts; changes are noticed", async () => {
    const { repo, deps } = setup();
    const site = await createSite(deps, { name: "Smith Tax", userId: null });
    await assert.rejects(publishSite(deps, site.id), /Add something to the home page/);
    const home = repo.pages[0];
    await savePage(deps, home.id, { title: "Home", blocks: [{ type: "heading", text: "Welcome" }] });
    assert.equal(hasUnpublishedChanges(await repo.listPages(site.id)), true);
    assert.equal(await publishSite(deps, site.id), 1);
    assert.equal(repo.site!.status, "published");
    assert.equal(hasUnpublishedChanges(await repo.listPages(site.id)), false);
    await savePage(deps, home.id, { title: "Home", blocks: [{ type: "heading", text: "Welcome back" }] });
    assert.equal(hasUnpublishedChanges(await repo.listPages(site.id)), true);
    assert.equal(JSON.stringify(repo.pages[0].published).includes("back"), false, "visitors still see the published copy");
  });
});

describe("domains", () => {
  test("the default address can change; taken and reserved ones are refused; the old address stops", async () => {
    const platform = new Platform();
    const a = setup(platform);
    const b = setup(platform);
    const sa = await createSite(a.deps, { name: "Alpha Tax", userId: null });
    await createSite(b.deps, { name: "Beta Tax", userId: null });
    await assert.rejects(setSubdomain(a.deps, sa, a.repo.domains, "beta-tax"), /taken/);
    await assert.rejects(setSubdomain(a.deps, sa, a.repo.domains, "www"), /reserved/);
    const renamed = await setSubdomain(a.deps, sa, a.repo.domains, "alpha-cpa");
    assert.equal(renamed.slug, "alpha-cpa");
    assert.equal(a.repo.domains[0].hostname, "alpha-cpa.monarchtaxsuite.com");
    assert.ok(!platform.hosts.has("alpha-tax.monarchtaxsuite.com"));
  });
  test("a custom domain: added at the host, shows records, goes live only when the host says so", async () => {
    const fake = new FakeDomains();
    const { repo, deps } = setup(new Platform(), randomUUID(), fake);
    const site = await createSite(deps, { name: "Smith Tax", userId: null });
    const d = await addCustomDomain(deps, site, repo.domains, "https://WWW.Smith-Tax.com/", "u1");
    assert.equal(d.hostname, "www.smith-tax.com");
    assert.equal(d.status, "pending");
    assert.equal(d.detail.verification?.[0].type, "TXT");
    await assert.rejects(addCustomDomain(deps, site, repo.domains, "www.smith-tax.com", "u1"), /already connected/);
    const still = await refreshDomain(deps, d.id);
    assert.equal(still.status, "pending");
    assert.equal(still.detail.misconfigured, true);
    fake.verified = true; fake.misconfigured = false;
    const live = await refreshDomain(deps, d.id);
    assert.equal(live.status, "active");
    assert.equal(live.last_checked_at, "2027-03-01T12:00:00.000Z");
    fake.known = false;
    assert.equal((await refreshDomain(deps, d.id)).status, "error");
  });
  test("another office's domain is refused before the host is touched", async () => {
    const platform = new Platform();
    const fakeA = new FakeDomains();
    const a = setup(platform, randomUUID(), fakeA);
    const b = setup(platform, randomUUID(), new FakeDomains());
    const sa = await createSite(a.deps, { name: "Alpha Tax", userId: null });
    const sb = await createSite(b.deps, { name: "Beta Tax", userId: null });
    await addCustomDomain(a.deps, sa, a.repo.domains, "alpha.com", null);
    const fakeB = b.deps.domains as FakeDomains;
    await assert.rejects(addCustomDomain(b.deps, sb, b.repo.domains, "alpha.com", null), /already connected/);
    assert.deepEqual(fakeB.calls, [], "the hosting project was not asked to add or remove anything");
  });
  test("the platform's own domain, three-domain limit, and unconfigured hosting", async () => {
    const { repo, deps } = setup();
    const site = await createSite(deps, { name: "Smith Tax", userId: null });
    await assert.rejects(addCustomDomain(deps, site, repo.domains, "x.monarchtaxsuite.com", null), /made for you/);
    for (const h of ["one.com", "two.com", "three.com"]) await addCustomDomain(deps, site, repo.domains, h, null);
    await assert.rejects(addCustomDomain(deps, site, repo.domains, "four.com", null), /at most 3/);
    const none = setup(new Platform(), randomUUID(), null);
    const s2 = await createSite(none.deps, { name: "No Host", userId: null });
    await assert.rejects(addCustomDomain(none.deps, s2, none.repo.domains, "x.com", null), /aren't turned on/);
  });
  test("removing a custom domain removes it at the host; the default address stays", async () => {
    const fake = new FakeDomains();
    const { repo, deps } = setup(new Platform(), randomUUID(), fake);
    const site = await createSite(deps, { name: "Smith Tax", userId: null });
    const d = await addCustomDomain(deps, site, repo.domains, "smith-tax.com", null);
    await removeDomain(deps, d.id);
    assert.ok(fake.calls.includes("remove:smith-tax.com"));
    assert.deepEqual(repo.domains.map((x) => x.kind), ["subdomain"]);
    await assert.rejects(removeDomain(deps, repo.domains[0].id), /can be changed but not removed/);
  });
});

describe("the hosting platform's API", () => {
  const env = { VERCEL_API_TOKEN: "tok_secret", VERCEL_PROJECT_ID: "prj_1", VERCEL_TEAM_ID: "team_1" };
  test("not configured without the token and project", () => {
    assert.deepEqual(vercelProblems({}), ["VERCEL_API_TOKEN is not set.", "VERCEL_PROJECT_ID is not set."]);
    assert.equal(vercelDomains({}), null);
    assert.equal(vercelDomains(env) !== null, true);
  });
  test("add, check and remove call the project's domain endpoints with the team scope", async () => {
    const calls: { method: string; url: string; auth: string | null; body: string | null }[] = [];
    const answers: Record<string, { status: number; json: unknown }> = {
      "POST /v10/projects/prj_1/domains": { status: 200, json: { name: "x.com", verified: false, verification: [{ type: "TXT", domain: "_vercel.x.com", value: "v" }] } },
      "GET /v9/projects/prj_1/domains/x.com": { status: 200, json: { verified: true } },
      "GET /v6/domains/x.com/config": { status: 200, json: { misconfigured: false } },
      "DELETE /v9/projects/prj_1/domains/x.com": { status: 200, json: {} },
    };
    const f = (async (url: string, init: RequestInit) => {
      const u = new URL(url);
      calls.push({ method: init.method ?? "GET", url, auth: (init.headers as Record<string, string>).authorization, body: (init.body as string) ?? null });
      const a = answers[`${init.method} ${u.pathname}`] ?? { status: 404, json: {} };
      return { ok: a.status < 300, status: a.status, json: async () => a.json } as Response;
    }) as unknown as typeof fetch;
    const port = vercelDomains(env, f)!;
    assert.equal((await port.add("x.com")).verification[0].value, "v");
    assert.deepEqual(await port.check("x.com"), { verified: true, verification: [], misconfigured: false });
    await port.remove("x.com");
    assert.ok(calls.every((c) => c.auth === "Bearer tok_secret" && c.url.includes("teamId=team_1")));
    assert.equal(calls[0].body, JSON.stringify({ name: "x.com" }));
  });
  test("a domain in use elsewhere, an unknown domain and a failing host are told apart", async () => {
    const mk = (status: number, json: unknown) => (async () => ({ ok: status < 300, status, json: async () => json }) as Response) as unknown as typeof fetch;
    await assert.rejects(vercelDomains(env, mk(409, { error: { code: "domain_already_in_use" } }))!.add("x.com"), /already attached/);
    await assert.rejects(vercelDomains(env, mk(400, { error: { code: "invalid_domain" } }))!.add("x.com"), /doesn't accept/);
    await assert.rejects(vercelDomains(env, mk(500, {}))!.add("x.com"), /vercel add domain 500/);
    assert.equal(await vercelDomains(env, mk(404, {}))!.check("x.com"), null);
    await vercelDomains(env, mk(404, {}))!.remove("x.com");
  });
});

describe("site settings and search details", () => {
  test("settings are cleaned: bad colors, links and unknown keys are dropped", () => {
    const s = settingsOf({ brand: { primary: "red", accent: "#ABCDEF", logoImageId: "nope" }, fonts: { heading: "comic" }, header: { ctaLabel: "Call", ctaHref: "javascript:alert(1)" }, social: { facebook: "http://x.com", instagram: "https://instagram.com/a" }, evil: 1, seo: { title: "x".repeat(200), noindex: "on" } });
    assert.equal(s.brand.primary, null);
    assert.equal(s.brand.accent, "#abcdef");
    assert.equal(s.brand.logoImageId, null);
    assert.equal(s.fonts.heading, "inter");
    assert.equal(s.header.ctaHref, "");
    assert.deepEqual(s.social, { instagram: "https://instagram.com/a" });
    assert.equal(s.seo.title.length, 70);
    assert.equal(s.seo.noindex, true);
    assert.deepEqual(settingsOf(undefined), DEFAULT_SETTINGS);
  });
  test("titles: the page's own title wins, the website's suffix is added, the home page uses the website's title", () => {
    const settings = settingsOf({ seo: { title: "Smith Tax | Atlanta", titleSuffix: "Smith Tax" } });
    const base = { siteName: "Smith", settings, seo: cleanPageSeo({}) };
    assert.equal(pageTitleFor({ ...base, pageTitle: "About", isHome: false }), "About | Smith Tax");
    assert.equal(pageTitleFor({ ...base, seo: cleanPageSeo({ title: "Who we are" }), pageTitle: "About", isHome: false }), "Who we are | Smith Tax");
    assert.equal(pageTitleFor({ ...base, pageTitle: "Home", isHome: true }), "Smith Tax | Atlanta");
  });
  test("a page or the whole website can be hidden from search engines", () => {
    assert.equal(pageIsIndexed(settingsOf({}), cleanPageSeo({})), true);
    assert.equal(pageIsIndexed(settingsOf({}), cleanPageSeo({ noindex: true })), false);
    assert.equal(pageIsIndexed(settingsOf({ seo: { noindex: true } }), cleanPageSeo({})), false);
  });
  test("saving a page keeps its search details, and changing settings or search details counts as unpublished", async () => {
    const { repo, deps } = setup();
    const site = await createSite(deps, { name: "Smith Tax", userId: null });
    const home = repo.pages[0];
    await savePage(deps, home.id, { title: "Home", description: "d".repeat(400), show_in_nav: "on", blocks: JSON.stringify([{ type: "heading", text: "Hello" }]), seo: { title: "Tax help", noindex: true } });
    const saved = (await repo.getPage(home.id))!;
    assert.equal((saved.description ?? "").length, 160);
    assert.deepEqual(cleanPageSeo(saved.seo), { title: "Tax help", shareImageId: null, noindex: true });
    await publishSite(deps, site.id);
    const pages = await repo.listPages(site.id);
    const fresh = (await repo.getSite(site.id))!;
    assert.equal(hasUnpublishedChanges(pages, fresh), false);
    await saveSiteSettings(deps, site.id, { hours: "Mon-Fri 9-5" });
    assert.equal(hasUnpublishedChanges(pages, (await repo.getSite(site.id))!), true);
  });
});

describe("a free address saved under an older platform domain", () => {
  test("changing to the same name brings the address up to the current domain", async () => {
    const { repo, deps } = setup();
    const site = await createSite(deps, { name: "Smith Tax", userId: null });
    const sub = repo.domains.find((d) => d.kind === "subdomain")!;
    sub.hostname = "smith-tax.oldplatform.com";
    await setSubdomain(deps, site, repo.domains, "smith-tax");
    assert.equal(repo.domains.find((d) => d.kind === "subdomain")!.hostname, "smith-tax.monarchtaxsuite.com");
  });
});

describe("a domain the platform owner already attached at the hosting side", () => {
  test("the owner's workspace connects it without adding it again; others still add it normally", async () => {
    const fake = new FakeDomains();
    fake.verified = true;
    fake.misconfigured = false;
    const own = setup(new Platform(), randomUUID(), fake);
    own.deps.adoptOwn = true;
    const site = await createSite(own.deps, { name: "MKB", userId: null });
    const d = await addCustomDomain(own.deps, site, own.repo.domains, "www.mkbfinancialgroup.com", null);
    assert.equal(d.status, "active");
    assert.ok(!fake.calls.includes("add:www.mkbfinancialgroup.com"));
    const other = new FakeDomains();
    const them = setup(new Platform(), randomUUID(), other);
    const s2 = await createSite(them.deps, { name: "Other", userId: null });
    await addCustomDomain(them.deps, s2, them.repo.domains, "www.other.com", null);
    assert.ok(other.calls.includes("add:www.other.com"));
    assert.ok(!other.calls.some((c) => c.startsWith("check:")), "no adopting for other offices");
  });
  test("the platform's own addresses can never be connected", async () => {
    const own = setup();
    own.deps.adoptOwn = true;
    const site = await createSite(own.deps, { name: "MKB", userId: null });
    for (const h of ["app.verexahq.com", "admin.verexahq.com", "www.monarchtaxsuite.com"]) await assert.rejects(addCustomDomain(own.deps, site, own.repo.domains, h, null), /belong to the platform|made for you automatically/i, h);
  });
});

describe("site fonts", () => {
  test("only the web fonts a site picked are requested; built-in fonts need no request", () => {
    assert.equal(googleFontsHref({ heading: "georgia", body: "system" }), null);
    const one = googleFontsHref({ heading: "inter", body: "inter" })!;
    assert.equal(one.match(/family=/g)?.length, 1);
    assert.match(one, /^https:\/\/fonts\.googleapis\.com\/css2\?family=Inter:wght@[0-9;]+&display=swap$/);
    assert.equal(googleFontsHref({ heading: "playfair", body: "lora" })!.match(/family=/g)?.length, 2);
    assert.equal(settingsOf({ fonts: { heading: "comic-sans" } }).fonts.heading, "inter");
  });
});

describe("page background", () => {
  test("a valid color is kept; anything else means white", () => {
    assert.equal(settingsOf({ brand: { pageBg: "#F6F4EE" } }).brand.pageBg, "#f6f4ee");
    assert.equal(settingsOf({ brand: { pageBg: "url(x)" } }).brand.pageBg, null);
    assert.equal(settingsOf({}).brand.pageBg, null);
  });
});

describe("page background photo", () => {
  const id = "8f0c1c1e-2b7a-4c55-9d6e-0a1b2c3d4e5f";
  test("a photo id, veil and text color are checked", () => {
    const b = settingsOf({ brand: { pageBgImageId: id, pageBgVeil: 200, pageBgText: "light" } }).brand;
    assert.equal(b.pageBgImageId, id);
    assert.equal(b.pageBgVeil, 80);
    assert.equal(b.pageBgText, "light");
    const bad = settingsOf({ brand: { pageBgImageId: "../x", pageBgVeil: "zz", pageBgText: "red" } }).brand;
    assert.deepEqual([bad.pageBgImageId, bad.pageBgVeil, bad.pageBgText], [null, 0, "dark"]);
  });
});
