import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { unwrap } from "../commerce/supabase-repo.ts";
import { TAG_MAX } from "../leads/tags.ts";
import type { AudienceContact, Channel, ConsentRow } from "./audience.ts";
import type { SendStats } from "./health.ts";
import type { Campaign, CampaignRepo, Recipient, StatusCounts, SuppressionReason } from "./service.ts";

const PAGE = 1000;
const MAX_ROWS = 50_000;

/** Reads every row of a query, a page at a time (the API returns at most 1000 per call). */
async function all<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const rows = unwrap(await page(from, from + PAGE - 1)) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

type LeadRow = { id: string; full_name: string | null; email: string | null; phone: string | null; status: string | null; tags: string[] | null };
type ClientRow = { id: string; full_name: string | null; email: string | null; phone: string | null; tags: string[] | null; archived_at: string | null };
type ApptRow = { contact_email: string; sms_consent: boolean };

/** One office's campaign rows, on its tenant-scoped client: row-level security limits every call to that tenant. */
export class SupabaseCampaignRepo implements CampaignRepo {
  private db: SupabaseClient;
  constructor(db: SupabaseClient) {
    this.db = db;
  }

  async listContacts(): Promise<AudienceContact[]> {
    const [leads, clients, appts] = await Promise.all([
      all<LeadRow>((a, b) => this.db.from("leads").select("id, full_name, email, phone, status, tags").order("created_at").range(a, b)),
      all<ClientRow>((a, b) => this.db.from("clients").select("id, full_name, email, phone, tags, archived_at").order("created_at").range(a, b)),
      all<ApptRow>((a, b) => this.db.from("appointments").select("contact_email, sms_consent").neq("status", "cancelled").order("created_at").range(a, b)),
    ]);
    const booked = new Map<string, boolean>();
    for (const a of appts) booked.set(a.contact_email, (booked.get(a.contact_email) ?? false) || a.sms_consent);
    const known = (email: string | null) => (email ? booked.has(email.toLowerCase()) : false);
    const sms = (email: string | null) => (email ? booked.get(email.toLowerCase()) === true : false);
    return [
      ...clients.map((c): AudienceContact => ({ kind: "client", id: c.id, name: c.full_name, email: c.email, phone: c.phone, tags: c.tags ?? [], status: null, archived: c.archived_at !== null, booked: known(c.email), bookingSms: sms(c.email) })),
      ...leads.map((l): AudienceContact => ({ kind: "lead", id: l.id, name: l.full_name, email: l.email, phone: l.phone, tags: l.tags ?? [], status: l.status, archived: false, booked: known(l.email), bookingSms: sms(l.email) })),
    ];
  }

  async listConsents(): Promise<ConsentRow[]> {
    const rows = await all<{ email: string; basis: ConsentRow["basis"]; sms_consent: boolean; revoked_at: string | null }>((a, b) => this.db.from("marketing_consents").select("email, basis, sms_consent, revoked_at").order("created_at").range(a, b));
    return rows.map((r) => ({ email: r.email, basis: r.basis, sms_consent: r.sms_consent, revoked: r.revoked_at !== null }));
  }

  async suppressed(channel: Channel): Promise<Set<string>> {
    const rows = await all<{ address: string }>((a, b) => this.db.from("marketing_suppressions").select("address").eq("channel", channel).order("created_at").range(a, b));
    return new Set(rows.map((r) => r.address));
  }
  async addSuppression(channel: Channel, address: string, reason: SuppressionReason, campaignId: string | null) {
    unwrap(await this.db.from("marketing_suppressions").upsert({ channel, address, reason, campaign_id: campaignId }, { onConflict: "tenant_id,channel,address", ignoreDuplicates: true }));
  }
  async removeSuppression(channel: Channel, address: string, onlyReason: SuppressionReason) {
    unwrap(await this.db.from("marketing_suppressions").delete().eq("channel", channel).eq("address", address).eq("reason", onlyReason));
  }

  async upsertConsent(i: { email: string; basis: "form" | "owner" | "import"; sms: boolean; markedBy: string | null; note: string | null }) {
    const at = new Date().toISOString();
    unwrap(await this.db.from("marketing_consents").upsert(
      { email: i.email, basis: i.basis, sms_consent: i.sms, sms_consent_at: i.sms ? at : null, marked_by: i.markedBy, note: i.note, revoked_at: null },
      { onConflict: "tenant_id,email" },
    ));
  }
  /** A form that adds respondents to Leads is the opt-in. Keeps any consent already on record (and a revoke) as it is. */
  async recordFormConsent(email: string) {
    unwrap(await this.db.from("marketing_consents").upsert({ email, basis: "form", note: "Submitted a form" }, { onConflict: "tenant_id,email", ignoreDuplicates: true }));
  }
  async revokeConsent(email: string, markedBy: string | null) {
    const at = new Date().toISOString();
    const existing = unwrap(await this.db.from("marketing_consents").select("email").eq("email", email).maybeSingle()) as { email: string } | null;
    if (existing) unwrap(await this.db.from("marketing_consents").update({ revoked_at: at, marked_by: markedBy }).eq("email", email));
    else unwrap(await this.db.from("marketing_consents").insert({ email, basis: "owner", revoked_at: at, marked_by: markedBy }));
  }

  async insertCampaign(input: Parameters<CampaignRepo["insertCampaign"]>[0]) {
    return unwrap(await this.db.from("campaigns").insert(input).select("*").single()) as Campaign;
  }
  async getCampaign(id: string) {
    return unwrap(await this.db.from("campaigns").select("*").eq("id", id).maybeSingle()) as Campaign | null;
  }
  async listCampaigns() {
    return unwrap(await this.db.from("campaigns").select("*").order("created_at", { ascending: false }).limit(200)) as Campaign[];
  }
  async updateCampaign(id: string, patch: Parameters<CampaignRepo["updateCampaign"]>[1]) {
    return unwrap(await this.db.from("campaigns").update(patch).eq("id", id).select("*").single()) as Campaign;
  }
  async deleteDraft(id: string) {
    unwrap(await this.db.from("campaigns").delete().eq("id", id).eq("status", "draft"));
  }
  async dueCampaigns(nowIso: string) {
    return unwrap(await this.db.from("campaigns").select("*").eq("status", "scheduled").lte("send_at", nowIso).order("send_at").limit(20)) as Campaign[];
  }
  async sendingCampaigns() {
    return unwrap(await this.db.from("campaigns").select("*").eq("status", "sending").order("started_at").limit(20)) as Campaign[];
  }

  async insertRecipients(rows: Parameters<CampaignRepo["insertRecipients"]>[0]) {
    if (rows.length) unwrap(await this.db.from("campaign_recipients").upsert(rows, { onConflict: "campaign_id,contact_kind,contact_id", ignoreDuplicates: true }));
  }
  async claim(campaignId: string, limit: number) {
    return unwrap(await this.db.rpc("campaign_claim", { p_campaign: campaignId, p_limit: limit })) as Recipient[];
  }
  async releaseStale(campaignId: string, beforeIso: string, channel: Channel) {
    // Email can safely be tried again (the provider ignores a repeated idempotency key); a text might already have gone out, so it is not.
    const patch = channel === "email" ? { status: "queued", claimed_at: null } : { status: "failed", error: "Interrupted while sending; not retried so nobody is texted twice." };
    const rows = unwrap(await this.db.from("campaign_recipients").update(patch).eq("campaign_id", campaignId).eq("status", "sending").lt("claimed_at", beforeIso).select("id")) as { id: string }[];
    return rows.length;
  }
  async setRecipient(id: string, patch: Parameters<CampaignRepo["setRecipient"]>[1]) {
    unwrap(await this.db.from("campaign_recipients").update(patch).eq("id", id));
  }
  async skipQueuedFor(address: string, reason: string) {
    const rows = unwrap(await this.db.from("campaign_recipients").update({ status: "skipped", skip_reason: reason }).eq("address", address).eq("status", "queued").select("id")) as { id: string }[];
    return rows.length;
  }
  async counts(campaignId: string): Promise<StatusCounts> {
    const rows = await all<{ status: keyof StatusCounts; opened_at: string | null; clicked_at: string | null; unsubscribed_at: string | null }>((a, b) => this.db.from("campaign_recipients").select("status, opened_at, clicked_at, unsubscribed_at").eq("campaign_id", campaignId).order("id").range(a, b));
    const c: StatusCounts = { queued: 0, sending: 0, sent: 0, delivered: 0, bounced: 0, complained: 0, failed: 0, skipped: 0, opened: 0, clicked: 0, unsubscribed: 0 };
    for (const r of rows) {
      c[r.status] += 1;
      if (r.opened_at) c.opened += 1;
      if (r.clicked_at) c.clicked += 1;
      if (r.unsubscribed_at) c.unsubscribed += 1;
    }
    return c;
  }
  async sendStats(sinceIso: string): Promise<SendStats> {
    const ids = (unwrap(await this.db.from("campaigns").select("id").eq("channel", "email").gte("started_at", sinceIso).limit(300)) as { id: string }[]).map((c) => c.id);
    if (!ids.length) return { sent: 0, bounced: 0, complained: 0 };
    const count = async (status?: string) => {
      let q = this.db.from("campaign_recipients").select("id", { count: "exact", head: true }).in("campaign_id", ids).gte("sent_at", sinceIso);
      if (status) q = q.eq("status", status);
      const r = await q;
      if (r.error) throw new Error(r.error.message);
      return r.count ?? 0;
    };
    const [sent, bounced, complained] = await Promise.all([count(), count("bounced"), count("complained")]);
    return { sent, bounced, complained };
  }
  async insertLinks(campaignId: string, urls: string[]) {
    unwrap(await this.db.from("campaign_links").upsert(urls.map((url, position) => ({ campaign_id: campaignId, position, url })), { onConflict: "campaign_id,position", ignoreDuplicates: true }));
  }
  async listLinks(campaignId: string) {
    return unwrap(await this.db.from("campaign_links").select("position, url, click_count").eq("campaign_id", campaignId).order("position")) as { position: number; url: string; click_count: number }[];
  }

  // Beyond the service's port: what the pages and public endpoints need.
  async listRecipients(campaignId: string, limit = 200, offset = 0) {
    return unwrap(await this.db.from("campaign_recipients").select("*").eq("campaign_id", campaignId).order("created_at").order("id").range(offset, offset + limit - 1)) as Recipient[];
  }
  async getRecipient(id: string) {
    return unwrap(await this.db.from("campaign_recipients").select("*").eq("id", id).maybeSingle()) as Recipient | null;
  }
  async countOpen(id: string) {
    unwrap(await this.db.rpc("campaign_note_event", { p_recipient: id, p_kind: "open" }));
  }
  async countClick(id: string, campaignId: string, position: number) {
    unwrap(await this.db.rpc("campaign_note_event", { p_recipient: id, p_kind: "click", p_link_campaign: campaignId, p_link_position: position }));
  }
  /** Adds or removes one tag on the given leads or clients. Returns how many people changed. */
  async tagContacts(kind: "lead" | "client", ids: string[], tag: string, remove: boolean): Promise<number> {
    let changed = 0;
    const table = kind === "lead" ? "leads" : "clients";
    for (let i = 0; i < ids.length; i += 200) {
      const rows = unwrap(await this.db.from(table).select("id, tags").in("id", ids.slice(i, i + 200))) as { id: string; tags: string[] | null }[];
      for (const r of rows) {
        const tags = r.tags ?? [];
        const next = remove ? tags.filter((t) => t !== tag) : tags.includes(tag) ? tags : [...tags, tag];
        if (next.length === tags.length && next.every((t, j) => t === tags[j])) continue;
        if (next.length > TAG_MAX) continue;
        unwrap(await this.db.from(table).update({ tags: next }).eq("id", r.id));
        changed++;
      }
    }
    return changed;
  }
  async listSegments() {
    return unwrap(await this.db.from("audience_segments").select("*").order("name").limit(200)) as { id: string; name: string; filter: unknown; created_at: string }[];
  }
  async saveSegment(name: string, filter: unknown, createdBy: string | null) {
    unwrap(await this.db.from("audience_segments").insert({ name, filter, created_by: createdBy }));
  }
  async removeSegment(id: string) {
    unwrap(await this.db.from("audience_segments").delete().eq("id", id));
  }
  async listSuppressions() {
    return unwrap(await this.db.from("marketing_suppressions").select("*").order("created_at", { ascending: false }).limit(500)) as { id: string; channel: Channel; address: string; reason: SuppressionReason; created_at: string }[];
  }
}
