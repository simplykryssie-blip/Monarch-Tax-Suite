import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { appOrigin } from "../admin";
import { automationDeps } from "../automation/server";
import { senderFor } from "../automation/engine.ts";
import { sanitizeError } from "../automation/sanitize.ts";
import { segmentCount } from "../automation/twilio.ts";
import { emailBrandOf } from "../branding/brand.ts";
import { loadBrand } from "../branding/server";
import { businessDeps } from "../calendar/server";
import { loadCalendar } from "../calendar/service.ts";
import { CrmSecrets } from "../crm/crypto.ts";
import { SupabaseDocumentsRepo } from "../documents/supabase-repo.ts";
import { tenantSms } from "../sms/server";
import { platformClient, tenantClient } from "../supabase/service";
import { currentTenantId } from "../tenants.ts";
import type { Channel } from "./audience.ts";
import { hashRecipientToken, TOKEN_SHAPE } from "./compose.ts";
import type { CampaignDeps, MailOutcome, Recipient } from "./service.ts";
import { SupabaseCampaignRepo } from "./supabase-repo.ts";

// Server wiring for campaigns. An office's campaigns run as that office (its tenant client, its sender, its texting
// account). Only three things look across offices, each through a logged platform lookup: finding a recipient from the
// secret in their link or from the provider's message id, the platform-wide list of hard bounces and complaints, and
// finding the office a text reply was sent to.

function secrets(): CrmSecrets {
  const s = CrmSecrets.fromBase64(process.env.MONARCH_ENCRYPTION_KEY);
  if (!s) throw new Error("MONARCH_ENCRYPTION_KEY is not configured, so campaign links cannot be made.");
  return s;
}
const linkKey = () => Buffer.from(secrets().hashIdentifier("campaign-link-key", "v1"), "hex");
const mac = (purpose: string, value: string) => createHmac("sha256", linkKey()).update(`${purpose}:${value}`).digest("base64url");
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** The signed address the text provider reports a message's delivery to. */
export const statusSignature = (recipientId: string) => mac("sms-status", recipientId);
export const statusSignatureOk = (recipientId: string, given: string) => same(statusSignature(recipientId), given);
/** The signed address text replies are sent to (set on the texting number's incoming-message webhook). */
export const inboundSignature = () => mac("sms-inbound", "v1");
export const inboundSignatureOk = (given: string) => same(inboundSignature(), given);
export async function inboundUrl(): Promise<string> {
  return `${await appOrigin()}/api/sms/inbound/${inboundSignature()}`;
}

const platformHash = (channel: Channel, address: string) => secrets().hashIdentifier(`platform-suppression:${channel}`, address.toLowerCase());

export function campaignRepo(tenantId: string = currentTenantId()) {
  return new SupabaseCampaignRepo(tenantClient(tenantId));
}

export function campaignDeps(tenantId: string = currentTenantId()): CampaignDeps & { repo: SupabaseCampaignRepo } {
  const db = tenantClient(tenantId);
  const repo = new SupabaseCampaignRepo(db);
  const auto = automationDeps(tenantId);
  const docs = new SupabaseDocumentsRepo(db);
  return {
    tenantId,
    repo,
    async office() {
      const [profile, brand] = await Promise.all([docs.getProfile().catch(() => null), loadBrand(tenantId)]);
      const eb = emailBrandOf(brand);
      return {
        name: profile?.display_name || brand.name,
        phone: profile?.phone ?? null,
        email: profile?.email ?? brand.supportEmail ?? null,
        address: profile?.address ?? null,
        brand: { name: eb.name, color: eb.color, textColor: eb.textColor, logoUrl: eb.logoUrl },
      };
    },
    calendar: () => loadCalendar(businessDeps(tenantId)),
    async mailer(senderId) {
      let from: Awaited<ReturnType<typeof senderFor>>;
      try {
        from = await senderFor(auto, senderId);
      } catch (e) {
        return { ok: false, problem: e instanceof Error ? e.message : "There is no verified sending address." };
      }
      return {
        ok: true,
        send: async (m): Promise<MailOutcome> => {
          const r = await auto.email.send({ ...from, to: m.to, subject: m.subject, html: m.html, text: m.text, headers: m.headers, idempotencyKey: m.idempotencyKey });
          return r.ok ? r : { ok: false, kind: r.kind, message: sanitizeError(r.message, 200) };
        },
      };
    },
    async texter() {
      const sms = await tenantSms(tenantId);
      if (!sms.sender) return { ok: false, problem: sms.route.ok ? "Text messaging is not connected." : sms.route.problem };
      const sender = sms.sender;
      const credits = sms.route.billing === "credits";
      return {
        ok: true,
        send: async (to, body, reference, statusCallback) => {
          const segments = segmentCount(body);
          if (credits && !(await sms.repo.spend(segments, reference))) return { ok: false, kind: "config", message: "Not enough text credits. Buy credits in Settings → Text messaging." };
          const r = await sender.send(to, body, { statusCallback });
          if (!r.ok) {
            if (credits) await sms.repo.reverseSend(reference);
            return { ok: false, kind: r.kind, message: sanitizeError(r.message, 200) };
          }
          return { ok: true, id: r.id, segments };
        },
      };
    },
    async platformBlocked(addresses, channel) {
      if (!addresses.length) return new Set();
      const byHash = new Map(addresses.map((a) => [platformHash(channel, a), a]));
      const found = new Set<string>();
      const hashes = [...byHash.keys()];
      for (let i = 0; i < hashes.length; i += 200) {
        const { data, error } = await platformClient("suppression").from("platform_suppressions").select("address_hash").eq("channel", channel).in("address_hash", hashes.slice(i, i + 200));
        if (error) throw new Error(`Could not check the platform-wide block list: ${error.message}`);
        for (const r of (data ?? []) as { address_hash: string }[]) found.add(byHash.get(r.address_hash)!);
      }
      return found;
    },
    async links() {
      const origin = await appOrigin();
      return { origin, key: linkKey(), textStatusUrl: (id: string) => `${origin}/api/sms/status/${id}/${statusSignature(id)}` };
    },
    production: auto.config.env === "production",
    testRecipients: auto.config.testRecipients,
  };
}

// ------------------------------------------------------- lookups across offices (logged platform access)

export type FoundRecipient = Recipient & { channel: Channel };

async function withChannel(row: Recipient | null): Promise<FoundRecipient | null> {
  if (!row) return null;
  const { data } = await tenantClient(row.tenant_id).from("campaigns").select("channel").eq("id", row.campaign_id).maybeSingle();
  return { ...row, channel: ((data as { channel?: Channel } | null)?.channel ?? "email") };
}

/** The recipient a link token belongs to, or null. */
export async function recipientByToken(token: string): Promise<FoundRecipient | null> {
  if (!TOKEN_SHAPE.test(token)) return null;
  const { data } = await platformClient("campaign_token").from("campaign_recipients").select("*").eq("token_hash", hashRecipientToken(token)).maybeSingle();
  return withChannel(data as Recipient | null);
}
export async function recipientById(id: string): Promise<FoundRecipient | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await platformClient("campaign_token").from("campaign_recipients").select("*").eq("id", id).maybeSingle();
  return withChannel(data as Recipient | null);
}
export async function recipientByProviderId(providerId: string): Promise<FoundRecipient | null> {
  if (!providerId || providerId.length > 100) return null;
  const { data } = await platformClient("campaign_token").from("campaign_recipients").select("*").eq("provider_id", providerId).maybeSingle();
  return withChannel(data as Recipient | null);
}

/** Adds an address to the platform-wide list (hard bounce or spam complaint only). Only the keyed hash is stored. */
export async function blockEverywhere(channel: Channel, address: string, reason: "hard_bounce" | "complaint"): Promise<void> {
  const { error } = await platformClient("suppression").from("platform_suppressions").upsert({ address_hash: platformHash(channel, address), channel, reason }, { onConflict: "channel,address_hash", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
}

/** The office whose texting number received a reply. */
export async function tenantForNumber(number: string): Promise<string | null> {
  const { data } = await platformClient("sms_inbound").from("tenant_sms_accounts").select("tenant_id").eq("from_number", number).limit(2);
  const rows = (data ?? []) as { tenant_id: string }[];
  return rows.length === 1 ? rows[0].tenant_id : null;
}
