import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { unwrap } from "../commerce/supabase-repo.ts";
import type { Site, SiteDomain, SitePage, SitesRepo } from "./service.ts";

/** Site rows of one office, on its tenant-scoped client: row-level security limits every call to that tenant. */
export class SupabaseSitesRepo implements SitesRepo {
  private db: SupabaseClient;
  private taken: (host: string) => Promise<boolean>;
  constructor(db: SupabaseClient, hostnameTaken: (host: string) => Promise<boolean>) {
    this.db = db;
    this.taken = hostnameTaken;
  }
  async getSite() {
    return unwrap(await this.db.from("sites").select("*").maybeSingle()) as Site | null;
  }
  async insertSite(input: Parameters<SitesRepo["insertSite"]>[0]) {
    return unwrap(await this.db.from("sites").insert(input).select("*").single()) as Site;
  }
  async updateSite(id: string, patch: Parameters<SitesRepo["updateSite"]>[1]) {
    return unwrap(await this.db.from("sites").update(patch).eq("id", id).select("*").single()) as Site;
  }
  async listPages(siteId: string) {
    return unwrap(await this.db.from("site_pages").select("*").eq("site_id", siteId).order("position").order("created_at").limit(100)) as SitePage[];
  }
  async getPage(id: string) {
    return unwrap(await this.db.from("site_pages").select("*").eq("id", id).maybeSingle()) as SitePage | null;
  }
  async insertPage(input: Parameters<SitesRepo["insertPage"]>[0]) {
    return unwrap(await this.db.from("site_pages").insert(input).select("*").single()) as SitePage;
  }
  async updatePage(id: string, patch: Parameters<SitesRepo["updatePage"]>[1]) {
    return unwrap(await this.db.from("site_pages").update(patch).eq("id", id).select("*").single()) as SitePage;
  }
  async removePage(id: string) {
    unwrap(await this.db.from("site_pages").delete().eq("id", id).eq("is_home", false));
  }
  async listDomains(siteId: string) {
    return unwrap(await this.db.from("site_domains").select("*").eq("site_id", siteId).order("created_at")) as SiteDomain[];
  }
  async getDomain(id: string) {
    return unwrap(await this.db.from("site_domains").select("*").eq("id", id).maybeSingle()) as SiteDomain | null;
  }
  async insertDomain(input: Parameters<SitesRepo["insertDomain"]>[0]) {
    return unwrap(await this.db.from("site_domains").insert(input).select("*").single()) as SiteDomain;
  }
  async updateDomain(id: string, patch: Parameters<SitesRepo["updateDomain"]>[1]) {
    return unwrap(await this.db.from("site_domains").update(patch).eq("id", id).select("*").single()) as SiteDomain;
  }
  async removeDomain(id: string) {
    unwrap(await this.db.from("site_domains").delete().eq("id", id).eq("kind", "custom"));
  }
  hostnameTaken(host: string) {
    return this.taken(host);
  }
  async publish(siteId: string) {
    const r = await this.db.rpc("site_publish", { p_site: siteId });
    if (r.error) {
      if (/SITE_EMPTY/.test(r.error.message)) throw new Error("This site has no pages to publish.");
      throw new Error(r.error.message);
    }
    return Number(r.data ?? 0);
  }
  async unpublish(siteId: string) {
    unwrap(await this.db.rpc("site_unpublish", { p_site: siteId }));
  }
}
