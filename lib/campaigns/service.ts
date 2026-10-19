import { randomUUID } from "node:crypto";
import { isOpenAt, type BusinessCalendar } from "../calendar/business.ts";
import { ValidationError } from "../commerce/validation.ts";
import { addressFor, resolveAudience, sanitizeFilter, type AudienceContact, type AudienceFilter, type AudienceResult, type Channel, type ConsentRow } from "./audience.ts";
import { hashRecipientToken, linkTable, messageProblems, recipientToken, renderEmail, renderSmsBody, smsSegments, valuesFor, type EmailBrandInput } from "./compose.ts";
import { batchFor, healthOf, type Health, type SendStats } from "./health.ts";

// Campaigns for one office: writing and scheduling them, turning a scheduled one into recipients, and sending a batch
// of recipients on each five-minute tick. Everything acts on the office the repository is built for.

export type CampaignStatus = "draft" | "scheduled" | "sending" | "sent" | "paused" | "cancelled";
export type Campaign = {
  id: string; tenant_id: string; name: string; channel: Channel; subject: string | null; body: string; sender_id: string | null; audience: AudienceFilter | Record<string, never>;
  status: CampaignStatus; send_at: string | null; respect_hours: boolean; paused_reason: string | null; recipient_count: number; started_at: string | null; finished_at: string | null; created_at: string; updated_at: string;
};
export type RecipientStatus = "queued" | "sending" | "sent" | "delivered" | "bounced" | "complained" | "failed" | "skipped";
export type Recipient = {
  id: string; tenant_id: string; campaign_id: string; contact_kind: "lead" | "client"; contact_id: string; name: string | null; address: string; token_hash: string; status: RecipientStatus;
  skip_reason: string | null; provider_id: string | null; error: string | null; segments: number | null; attempts: number; claimed_at: string | null; sent_at: string | null; delivered_at: string | null;
  opened_at: string | null; open_count: number; clicked_at: string | null; click_count: number; unsubscribed_at: string | null; created_at: string;
};
export type NewRecipient = Pick<Recipient, "id" | "contact_kind" | "contact_id" | "name" | "address" | "token_hash"> & { campaign_id: string };
export type CampaignInput = { name: unknown; channel: unknown; subject: unknown; body: unknown; audience: unknown; respect_hours: unknown; sender_id?: unknown };
export type SuppressionReason = "unsubscribed" | "stop" | "bounced" | "complaint" | "manual";
export type StatusCounts = Record<RecipientStatus, number> & { opened: number; clicked: number; unsubscribed: number };

export interface CampaignRepo {
  listContacts(): Promise<AudienceContact[]>;
  listConsents(): Promise<ConsentRow[]>;
  suppressed(channel: Channel): Promise<Set<string>>;
  addSuppression(channel: Channel, address: string, reason: SuppressionReason, campaignId: string | null): Promise<void>;
  removeSuppression(channel: Channel, address: string, onlyReason: SuppressionReason): Promise<void>;
  upsertConsent(input: { email: string; basis: "form" | "owner" | "import"; sms: boolean; markedBy: string | null; note: string | null }): Promise<void>;
  revokeConsent(email: string, markedBy: string | null): Promise<void>;

  insertCampaign(input: Pick<Campaign, "name" | "channel" | "subject" | "body" | "audience" | "respect_hours" | "sender_id"> & { created_by: string | null }): Promise<Campaign>;
  getCampaign(id: string): Promise<Campaign | null>;
  listCampaigns(): Promise<Campaign[]>;
  updateCampaign(id: string, patch: Partial<Pick<Campaign, "name" | "subject" | "body" | "audience" | "respect_hours" | "sender_id" | "status" | "send_at" | "paused_reason" | "recipient_count" | "started_at" | "finished_at">>): Promise<Campaign>;
  /** Scheduled campaigns whose time has come, and campaigns still sending. */
  dueCampaigns(nowIso: string): Promise<Campaign[]>;
  sendingCampaigns(): Promise<Campaign[]>;

  insertRecipients(rows: NewRecipient[]): Promise<void>;
  /** Atomically takes up to `limit` queued recipients (marks them sending). */
  claim(campaignId: string, limit: number): Promise<Recipient[]>;
  /** Recipients taken a long time ago and never finished go back to the queue (email) or are marked failed (text, never sent twice). */
  releaseStale(campaignId: string, beforeIso: string, channel: Channel): Promise<number>;
  setRecipient(id: string, patch: Partial<Pick<Recipient, "status" | "skip_reason" | "provider_id" | "error" | "segments" | "attempts" | "sent_at" | "delivered_at" | "unsubscribed_at">>): Promise<void>;
  skipQueuedFor(address: string, reason: string): Promise<number>;
  counts(campaignId: string): Promise<StatusCounts>;
  /** Sends, bounces and complaints of this office's email since a date. */
  sendStats(sinceIso: string): Promise<SendStats>;
  insertLinks(campaignId: string, urls: string[]): Promise<void>;
  listLinks(campaignId: string): Promise<{ position: number; url: string; click_count: number }[]>;
}

export type OfficeFacts = { name: string; phone: string | null; email: string | null; address: string | null; brand: EmailBrandInput };
export type MailOutcome = { ok: true; id: string } | { ok: false; kind: "config" | "transient" | "permanent"; message: string };
export type CampaignDeps = {
  tenantId: string;
  repo: CampaignRepo;
  office(): Promise<OfficeFacts>;
  calendar(): Promise<BusinessCalendar>;
  /** The office's own verified sending address for this campaign, or why there isn't one. */
  mailer(senderId: string | null): Promise<{ ok: true; send: (m: { to: string; subject: string; html: string; text: string; headers: Record<string, string>; idempotencyKey: string }) => Promise<MailOutcome> } | { ok: false; problem: string }>;
  /** Text messaging for this office, or why it isn't ready. `send` spends credits and returns the parts used. */
  texter(): Promise<{ ok: true; send: (to: string, body: string, reference: string, statusCallback: string) => Promise<{ ok: true; id: string; segments: number } | { ok: false; kind: "config" | "transient" | "permanent"; message: string }> } | { ok: false; problem: string }>;
  /** Which of these addresses are on the platform-wide list (hard bounces and complaints). */
  platformBlocked(addresses: string[], channel: Channel): Promise<Set<string>>;
  /** Base address for tracking, unsubscribe and status links, and the secret the per-recipient tokens come from. */
  links(): Promise<{ origin: string; key: Buffer; textStatusUrl: (recipientId: string) => string }>;
  /** Outside production nothing is sent to anyone but the test recipients. */
  production: boolean;
  testRecipients: string[];
  now?: () => Date;
  newId?: () => string;
};
const nowOf = (d: CampaignDeps) => (d.now ? d.now() : new Date());
const fail = (m: string): never => { throw new ValidationError(m); };
const idOf = (d: CampaignDeps) => (d.newId ? d.newId() : randomUUID());

export const BATCH = 60;
export const STALE_MINUTES = 10;
export const HEALTH_DAYS = 30;
export const MAX_ATTEMPTS = 3;

// ----------------------------------------------------------------- writing

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").replace(/\r\n/g, "\n").slice(0, max) : "");

export async function saveCampaign(deps: CampaignDeps, id: string | null, raw: CampaignInput, userId: string | null): Promise<Campaign> {
  const name = clean(raw.name, 120).replace(/\s+/g, " ").trim();
  if (name.length < 1) fail("Give the campaign a name.");
  const subject = raw.channel === "sms" ? null : clean(raw.subject, 200).replace(/\s+/g, " ").trim() || null;
  const fields = {
    name, subject, body: clean(raw.body, 20000), audience: sanitizeFilter(raw.audience), respect_hours: raw.respect_hours === true || raw.respect_hours === "on" || raw.respect_hours === "1",
    sender_id: typeof raw.sender_id === "string" && /^[0-9a-f-]{36}$/i.test(raw.sender_id) ? raw.sender_id : null,
  };
  if (id) {
    const c = (await deps.repo.getCampaign(id)) ?? fail("That campaign wasn't found.");
    if (c.status !== "draft") fail("Only a draft can be edited. Cancel it or make a copy first.");
    return deps.repo.updateCampaign(id, fields);
  }
  const channel = raw.channel === "sms" ? "sms" : raw.channel === "email" ? "email" : fail("Choose email or text.");
  return deps.repo.insertCampaign({ ...fields, channel: channel as Channel, created_by: userId });
}

/** Who a campaign would reach right now, and who is left out and why. */
export async function previewAudience(deps: CampaignDeps, channel: Channel, rawFilter: unknown): Promise<AudienceResult> {
  const filter = sanitizeFilter(rawFilter);
  const [contacts, consents, suppressed] = await Promise.all([deps.repo.listContacts(), deps.repo.listConsents(), deps.repo.suppressed(channel)]);
  const candidates = contacts.map((c) => addressFor(c, channel)).filter((a): a is string => a !== null);
  const blocked = await deps.platformBlocked(candidates, channel);
  return resolveAudience(contacts, filter, { channel, consents: new Map(consents.map((c) => [c.email, c])), suppressed, platformBlocked: (a) => blocked.has(a) });
}

/** The office's recent sending health: its own bounce and complaint rates over the last 30 days. */
export async function officeHealth(deps: CampaignDeps): Promise<Health> {
  return healthOf(await deps.repo.sendStats(new Date(nowOf(deps).getTime() - HEALTH_DAYS * 86_400_000).toISOString()));
}

/** Everything that stops this campaign from being scheduled, in plain words. */
export async function scheduleProblems(deps: CampaignDeps, c: Campaign): Promise<string[]> {
  const office = await deps.office();
  const problems = messageProblems({ channel: c.channel, subject: c.subject, body: c.body }, { address: office.address });
  if (c.channel === "email") {
    const m = await deps.mailer(c.sender_id);
    if (!m.ok) problems.push(m.problem);
    else if ((await officeHealth(deps)).level === "paused") problems.push((await officeHealth(deps)).reason ?? "Sending is paused because of recent bounces or complaints.");
  } else {
    const t = await deps.texter();
    if (!t.ok) problems.push(t.problem);
  }
  return problems;
}

/** Schedules a draft: now (null) or at a time. The audience is worked out when sending starts, so consent and unsubscribes are as of then. */
export async function scheduleCampaign(deps: CampaignDeps, id: string, sendAt: Date | null): Promise<Campaign> {
  const c = (await deps.repo.getCampaign(id)) ?? fail("That campaign wasn't found.");
  if (c.status !== "draft" && c.status !== "paused") fail("Only a draft or a paused campaign can be scheduled.");
  const problems = await scheduleProblems(deps, c);
  if (problems.length) fail(problems[0]);
  const preview = await previewAudience(deps, c.channel, c.audience);
  if (preview.eligible.length === 0) fail("Nobody in this audience can be sent this campaign. See who is left out and why on the audience step.");
  const when = sendAt ?? nowOf(deps);
  if (sendAt && sendAt.getTime() < nowOf(deps).getTime() - 60_000) fail("Choose a time in the future, or send now.");
  return deps.repo.updateCampaign(id, { status: "scheduled", send_at: when.toISOString(), paused_reason: null });
}

export async function cancelCampaign(deps: CampaignDeps, id: string): Promise<void> {
  const c = (await deps.repo.getCampaign(id)) ?? fail("That campaign wasn't found.");
  if (c.status === "sent" || c.status === "cancelled") fail("That campaign is already finished.");
  await deps.repo.updateCampaign(id, { status: "cancelled", finished_at: nowOf(deps).toISOString() });
}

export async function pauseCampaign(deps: CampaignDeps, id: string, reason: string): Promise<void> {
  await deps.repo.updateCampaign(id, { status: "paused", paused_reason: reason.slice(0, 300) });
}

/** A copy as a new draft (a sent campaign can't be edited, but its message can be reused). */
export async function copyCampaign(deps: CampaignDeps, id: string, userId: string | null): Promise<Campaign> {
  const c = (await deps.repo.getCampaign(id)) ?? fail("That campaign wasn't found.");
  return deps.repo.insertCampaign({ name: `${c.name} (copy)`.slice(0, 120), channel: c.channel, subject: c.subject, body: c.body, audience: c.audience, respect_hours: c.respect_hours, sender_id: c.sender_id, created_by: userId });
}

// ----------------------------------------------------------------- sending

/** Scheduled → sending: works out the audience as of now and queues one row per person. */
export async function activateCampaign(deps: CampaignDeps, c: Campaign): Promise<number> {
  const result = await previewAudience(deps, c.channel, c.audience);
  const { key } = await deps.links();
  const rows: NewRecipient[] = result.eligible.map((e) => {
    const id = idOf(deps);
    return { id, campaign_id: c.id, contact_kind: e.kind, contact_id: e.id, name: e.name, address: e.address, token_hash: hashRecipientToken(recipientToken(key, id)) };
  });
  for (let i = 0; i < rows.length; i += 500) await deps.repo.insertRecipients(rows.slice(i, i + 500));
  if (c.channel === "email") {
    const urls = linkTable(c.body);
    if (urls.length) await deps.repo.insertLinks(c.id, urls);
  }
  await deps.repo.updateCampaign(c.id, { status: rows.length ? "sending" : "sent", recipient_count: rows.length, started_at: nowOf(deps).toISOString(), ...(rows.length ? {} : { finished_at: nowOf(deps).toISOString() }) });
  return rows.length;
}

const isTestAddress = (d: CampaignDeps, address: string) => d.testRecipients.some((t) => t.trim().toLowerCase() === address.toLowerCase() || t.replace(/[^\d+]/g, "") === address);

/** Sends one batch for a campaign that is sending. Returns how many were handled (sent, skipped or failed). */
export async function sendBatch(deps: CampaignDeps, c: Campaign): Promise<number> {
  const office = await deps.office();
  // Business hours: a campaign that respects them waits for the office to be open, except texts never go out at night.
  if (c.respect_hours && !isOpenAt(await deps.calendar(), nowOf(deps))) return 0;
  const health = c.channel === "email" ? await officeHealth(deps) : { level: "ok" as const, reason: null };
  if (health.level === "paused") {
    await pauseCampaign(deps, c.id, health.reason ?? "Paused because of recent bounces or complaints.");
    return 0;
  }
  await deps.repo.releaseStale(c.id, new Date(nowOf(deps).getTime() - STALE_MINUTES * 60_000).toISOString(), c.channel);
  const mail = c.channel === "email" ? await deps.mailer(c.sender_id) : null;
  const text = c.channel === "sms" ? await deps.texter() : null;
  const route = mail ?? text!;
  if (!route.ok) { await pauseCampaign(deps, c.id, route.problem); return 0; }
  const claimed = await deps.repo.claim(c.id, batchFor(health.level, BATCH));
  if (claimed.length) {
    const [suppressed, blocked, links] = await Promise.all([deps.repo.suppressed(c.channel), deps.platformBlocked(claimed.map((r) => r.address), c.channel), deps.links()]);
    const linkRows = c.channel === "email" ? await deps.repo.listLinks(c.id) : [];
    const position = new Map(linkRows.map((l) => [l.url, l.position]));
    let configProblem: string | null = null;
    for (const r of claimed) {
      if (configProblem) { await deps.repo.setRecipient(r.id, { status: "queued" }); continue; }
      if (suppressed.has(r.address)) { await deps.repo.setRecipient(r.id, { status: "skipped", skip_reason: "unsubscribed or blocked" }); continue; }
      if (blocked.has(r.address)) { await deps.repo.setRecipient(r.id, { status: "skipped", skip_reason: "blocked platform-wide" }); continue; }
      if (!deps.production && !isTestAddress(deps, r.address)) { await deps.repo.setRecipient(r.id, { status: "skipped", skip_reason: "held back: outside production only test recipients are contacted" }); continue; }
      const token = recipientToken(links.key, r.id);
      const values = valuesFor({ name: r.name }, office);
      const at = nowOf(deps).toISOString();
      if (c.channel === "email" && mail && mail.ok) {
        const unsub = `${links.origin}/u/${token}`;
        const email = renderEmail({
          subject: c.subject ?? "", body: c.body, values, brand: office.brand, address: office.address ?? "", unsubscribeUrl: unsub,
          trackLink: (u) => `${links.origin}/t/c/${token}/${position.get(u) ?? 0}`, openPixel: `${links.origin}/t/o/${token}.gif`,
        });
        const out = await mail.send({
          to: r.address, subject: email.subject, html: email.html, text: email.text, idempotencyKey: `campaign:${r.id}`,
          headers: { "List-Unsubscribe": `<${unsub}/one-click>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
        });
        if (out.ok) await deps.repo.setRecipient(r.id, { status: "sent", provider_id: out.id, sent_at: at });
        else if (out.kind === "config") { configProblem = out.message; await deps.repo.setRecipient(r.id, { status: "queued" }); }
        else if (out.kind === "transient" && r.attempts + 1 < MAX_ATTEMPTS) await deps.repo.setRecipient(r.id, { status: "queued", attempts: r.attempts + 1, error: out.message.slice(0, 300) });
        else await deps.repo.setRecipient(r.id, { status: "failed", attempts: r.attempts + 1, error: out.message.slice(0, 300) });
      } else if (c.channel === "sms" && text && text.ok) {
        const body = renderSmsBody(c.body, values);
        const out = await text.send(r.address, body, `campaign:${r.id}`, links.textStatusUrl(r.id));
        if (out.ok) await deps.repo.setRecipient(r.id, { status: "sent", provider_id: out.id, segments: out.segments, sent_at: at });
        else if (out.kind === "config") { configProblem = out.message; await deps.repo.setRecipient(r.id, { status: "queued" }); }
        else if (out.kind === "transient" && r.attempts + 1 < MAX_ATTEMPTS) await deps.repo.setRecipient(r.id, { status: "queued", attempts: r.attempts + 1, error: out.message.slice(0, 300) });
        else await deps.repo.setRecipient(r.id, { status: "failed", attempts: r.attempts + 1, error: out.message.slice(0, 300) });
      }
    }
    if (configProblem) { await pauseCampaign(deps, c.id, `Sending stopped: ${configProblem}`.slice(0, 300)); return claimed.length; }
  }
  const counts = await deps.repo.counts(c.id);
  if (counts.queued === 0 && counts.sending === 0) await deps.repo.updateCampaign(c.id, { status: "sent", finished_at: nowOf(deps).toISOString() });
  return claimed.length;
}

/** The five-minute job for one office: start what is due, then send a batch of everything that is sending. Returns messages handled. */
export async function runCampaigns(deps: CampaignDeps): Promise<number> {
  let handled = 0;
  for (const c of await deps.repo.dueCampaigns(nowOf(deps).toISOString())) {
    try { await activateCampaign(deps, c); } catch (e) { await pauseCampaign(deps, c.id, `Couldn't start: ${e instanceof Error ? e.message : "unknown error"}`.slice(0, 300)); }
  }
  for (const c of await deps.repo.sendingCampaigns()) handled += await sendBatch(deps, c);
  return handled;
}

// ------------------------------------------------- what recipients and providers report

export type RecipientRef = Pick<Recipient, "id" | "campaign_id" | "address" | "status" | "opened_at" | "clicked_at" | "unsubscribed_at">;

/** The person asked to stop (the unsubscribe page or the one-click header). Stops them for this office only. */
export async function unsubscribeRecipient(deps: CampaignDeps, r: RecipientRef & { channel?: Channel }): Promise<void> {
  const at = nowOf(deps).toISOString();
  await deps.repo.addSuppression("email", r.address.toLowerCase(), "unsubscribed", r.campaign_id);
  await deps.repo.setRecipient(r.id, { unsubscribed_at: r.unsubscribed_at ?? at });
  await deps.repo.skipQueuedFor(r.address, "unsubscribed");
}

/** A text reply of STOP (or START to come back). */
export async function textKeyword(deps: CampaignDeps, number: string, keyword: "stop" | "start"): Promise<void> {
  if (keyword === "stop") {
    await deps.repo.addSuppression("sms", number, "stop", null);
    await deps.repo.skipQueuedFor(number, "replied STOP");
  } else {
    await deps.repo.removeSuppression("sms", number, "stop");
  }
}
export const STOP_WORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit"]);
export const START_WORDS = new Set(["start", "unstop"]);
export function keywordOf(body: string): "stop" | "start" | "help" | null {
  const w = body.trim().toLowerCase().replace(/[^a-z]/g, "");
  return STOP_WORDS.has(w) ? "stop" : START_WORDS.has(w) ? "start" : w === "help" ? "help" : null;
}

/** Provider says the email bounced or was marked as spam. Both stop all further campaign mail to that address from this office. */
export async function mailProblem(deps: CampaignDeps, r: RecipientRef, kind: "bounced" | "complained"): Promise<void> {
  await deps.repo.setRecipient(r.id, { status: kind });
  await deps.repo.addSuppression("email", r.address.toLowerCase(), kind === "bounced" ? "bounced" : "complaint", r.campaign_id);
  await deps.repo.skipQueuedFor(r.address, kind);
}
export async function mailDelivered(deps: CampaignDeps, r: RecipientRef): Promise<void> {
  if (r.status === "sent") await deps.repo.setRecipient(r.id, { status: "delivered", delivered_at: nowOf(deps).toISOString() });
}
/** Twilio's delivery report for a campaign text. */
export async function textReport(deps: CampaignDeps, r: RecipientRef, status: string, errorCode: string | null): Promise<void> {
  if (status === "delivered") { if (r.status === "sent") await deps.repo.setRecipient(r.id, { status: "delivered", delivered_at: nowOf(deps).toISOString() }); return; }
  if (status === "undelivered" || status === "failed") {
    await deps.repo.setRecipient(r.id, { status: "failed", error: `Not delivered${errorCode ? ` (carrier code ${errorCode.replace(/\D/g, "").slice(0, 6)})` : ""}` });
    // 21610: the person had already opted out with the carrier. Remember it so they aren't tried again.
    if (errorCode === "21610") await textKeyword(deps, r.address, "stop");
  }
}
export const segmentsOf = (body: string) => smsSegments(body).segments;
