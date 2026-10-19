import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { DEFAULT_TIME_ZONE, DEFAULT_WEEK } from "../lib/calendar/business.ts";
import type { AudienceContact, Channel, ConsentRow } from "../lib/campaigns/audience.ts";
import { hashRecipientToken, recipientToken } from "../lib/campaigns/compose.ts";
import {
  activateCampaign, keywordOf, mailDelivered, mailProblem, runCampaigns, saveCampaign, scheduleCampaign, sendBatch, textKeyword, textReport, unsubscribeRecipient,
  type Campaign, type CampaignDeps, type CampaignRepo, type MailOutcome, type Recipient, type StatusCounts, type SuppressionReason,
} from "../lib/campaigns/service.ts";

const TENANT = randomUUID();
const KEY = Buffer.alloc(32, 7);
const NOON = new Date("2026-03-04T17:00:00Z"); // a Wednesday, 12:00 in New York
const NIGHT = new Date("2026-03-04T03:00:00Z");

function memory(contacts: AudienceContact[]) {
  const campaigns = new Map<string, Campaign>();
  const recipients = new Map<string, Recipient>();
  const links: { campaign_id: string; position: number; url: string; click_count: number }[] = [];
  const suppressions = new Map<string, SuppressionReason>();
  const consents: ConsentRow[] = [];
  const repo: CampaignRepo = {
    listContacts: async () => contacts,
    listConsents: async () => consents,
    suppressed: async (ch) => new Set([...suppressions.keys()].filter((k) => k.startsWith(`${ch}|`)).map((k) => k.slice(ch.length + 1))),
    addSuppression: async (ch, a, reason) => { suppressions.set(`${ch}|${a}`, reason); },
    removeSuppression: async (ch, a, only) => { if (suppressions.get(`${ch}|${a}`) === only) suppressions.delete(`${ch}|${a}`); },
    upsertConsent: async () => undefined,
    revokeConsent: async () => undefined,
    insertCampaign: async (i) => {
      const c: Campaign = { id: randomUUID(), tenant_id: TENANT, ...i, status: "draft", send_at: null, paused_reason: null, recipient_count: 0, started_at: null, finished_at: null, created_at: "", updated_at: "" };
      campaigns.set(c.id, c);
      return c;
    },
    getCampaign: async (id) => campaigns.get(id) ?? null,
    listCampaigns: async () => [...campaigns.values()],
    updateCampaign: async (id, patch) => { const c = { ...campaigns.get(id)!, ...patch }; campaigns.set(id, c); return c; },
    dueCampaigns: async (now) => [...campaigns.values()].filter((c) => c.status === "scheduled" && c.send_at !== null && c.send_at <= now),
    sendingCampaigns: async () => [...campaigns.values()].filter((c) => c.status === "sending"),
    insertRecipients: async (rows) => {
      for (const r of rows) recipients.set(r.id, { ...r, tenant_id: TENANT, status: "queued", skip_reason: null, provider_id: null, error: null, segments: null, attempts: 0, claimed_at: null, sent_at: null, delivered_at: null, opened_at: null, open_count: 0, clicked_at: null, click_count: 0, unsubscribed_at: null, created_at: "" });
    },
    claim: async (cid, limit) => {
      const take = [...recipients.values()].filter((r) => r.campaign_id === cid && r.status === "queued").slice(0, limit);
      for (const r of take) r.status = "sending";
      return take.map((r) => ({ ...r }));
    },
    releaseStale: async () => 0,
    setRecipient: async (id, patch) => { Object.assign(recipients.get(id)!, patch); },
    skipQueuedFor: async (address, reason) => { let n = 0; for (const r of recipients.values()) if (r.address === address && r.status === "queued") { r.status = "skipped"; r.skip_reason = reason; n++; } return n; },
    counts: async (cid) => {
      const c = { queued: 0, sending: 0, sent: 0, delivered: 0, bounced: 0, complained: 0, failed: 0, skipped: 0, opened: 0, clicked: 0, unsubscribed: 0 } as StatusCounts;
      for (const r of recipients.values()) if (r.campaign_id === cid) c[r.status]++;
      return c;
    },
    sendStats: async () => ({ sent: 0, bounced: 0, complained: 0 }),
    insertLinks: async (cid, urls) => { urls.forEach((url, position) => links.push({ campaign_id: cid, position, url, click_count: 0 })); },
    listLinks: async (cid) => links.filter((l) => l.campaign_id === cid),
  };
  return { repo, campaigns, recipients, suppressions, consents };
}

const person = (n: number, over: Partial<AudienceContact> = {}): AudienceContact => ({ kind: "client", id: randomUUID(), name: `Person ${n}`, email: `p${n}@example.com`, phone: `+1555010${String(1000 + n).slice(-4)}`, tags: [], status: null, archived: false, booked: false, bookingSms: false, ...over });

function setup(contacts: AudienceContact[], over: Partial<CampaignDeps> = {}, at = NOON) {
  const m = memory(contacts);
  const mails: { to: string; subject: string; html: string; headers: Record<string, string>; key: string }[] = [];
  const texts: { to: string; body: string; cb: string }[] = [];
  let mailResult: (to: string) => MailOutcome = () => ({ ok: true, id: `re_${randomUUID()}` });
  const deps: CampaignDeps = {
    tenantId: TENANT, repo: m.repo,
    office: async () => ({ name: "Test Office", phone: "555-0100", email: "office@example.com", address: "1 Main St, Springfield", brand: { name: "Test Office", color: "#123456", textColor: "#ffffff", logoUrl: null } }),
    calendar: async () => ({ timeZone: DEFAULT_TIME_ZONE, week: DEFAULT_WEEK, closures: [] }),
    mailer: async () => ({ ok: true, send: async (x) => { mails.push({ to: x.to, subject: x.subject, html: x.html, headers: x.headers, key: x.idempotencyKey }); return mailResult(x.to); } }),
    texter: async () => ({ ok: true, send: async (to, body, _ref, cb) => { texts.push({ to, body, cb }); return { ok: true, id: `SM${randomUUID()}`, segments: 1 }; } }),
    platformBlocked: async () => new Set(),
    links: async () => ({ origin: "https://app.example.com", key: KEY, textStatusUrl: (id) => `https://app.example.com/api/sms/status/${id}/sig` }),
    production: true, testRecipients: [], now: () => at,
    ...over,
  };
  return { ...m, deps, mails, texts, setMail: (f: (to: string) => MailOutcome) => { mailResult = f; } };
}

const draft = async (s: ReturnType<typeof setup>, channel: Channel = "email", audience: unknown = {}) =>
  saveCampaign(s.deps, null, { name: "Spring", channel, subject: channel === "email" ? "Your spring checkup" : "", body: channel === "email" ? "Hello {{first_name}}, see [our page](https://example.com/a)." : "Hi {{first_name}}, your spring checkup is open.", audience, respect_hours: false }, null);

test("a scheduled campaign becomes one queued row per eligible person and is sent in batches", async () => {
  const s = setup([person(1), person(2), person(3, { kind: "lead" })]);
  const c = await draft(s);
  await scheduleCampaign(s.deps, c.id, null);
  assert.equal(await runCampaigns(s.deps), 2);
  assert.equal(s.campaigns.get(c.id)!.status, "sent");
  assert.equal(s.mails.length, 2);
  assert.ok(s.mails.every((m) => m.headers["List-Unsubscribe"].includes("/u/") && m.headers["List-Unsubscribe-Post"] === "List-Unsubscribe=One-Click"));
  assert.ok(s.mails[0].html.includes("/t/c/") && s.mails[0].html.includes("/t/o/"));
  assert.match(s.mails[0].html, /Springfield/);
});

test("the stored token hash matches the token in the email", async () => {
  const s = setup([person(1)]);
  const c = await draft(s);
  await scheduleCampaign(s.deps, c.id, null);
  await runCampaigns(s.deps);
  const r = [...s.recipients.values()][0];
  assert.equal(r.token_hash, hashRecipientToken(recipientToken(KEY, r.id)));
  assert.ok(s.mails[0].html.includes(recipientToken(KEY, r.id)));
});

test("someone who unsubscribes after scheduling is left out when sending starts", async () => {
  const s = setup([person(1), person(2)]);
  const c = await draft(s);
  await scheduleCampaign(s.deps, c.id, new Date(NOON.getTime() + 3600_000));
  await s.repo.addSuppression("email", "p1@example.com", "unsubscribed", null);
  await runCampaigns({ ...s.deps, now: () => new Date(NOON.getTime() + 3700_000) });
  assert.deepEqual(s.mails.map((m) => m.to), ["p2@example.com"]);
});

test("a queued person who unsubscribes mid-campaign is skipped, and never mailed again", async () => {
  const s = setup([person(1), person(2)]);
  const c = await draft(s);
  await scheduleCampaign(s.deps, c.id, null);
  await activateCampaign(s.deps, s.campaigns.get(c.id)!);
  const r = [...s.recipients.values()].find((x) => x.address === "p1@example.com")!;
  await unsubscribeRecipient(s.deps, r);
  await sendBatch(s.deps, s.campaigns.get(c.id)!);
  assert.deepEqual(s.mails.map((m) => m.to), ["p2@example.com"]);
  assert.equal(r.status, "skipped");
  assert.ok(r.unsubscribed_at);
});

test("platform-wide blocked addresses are skipped", async () => {
  const s = setup([person(1), person(2)], { platformBlocked: async (a) => new Set(a.filter((x) => x === "p2@example.com")) });
  const c = await draft(s);
  await scheduleCampaign(s.deps, c.id, null);
  await runCampaigns(s.deps);
  assert.deepEqual(s.mails.map((m) => m.to), ["p1@example.com"]);
});

test("outside production only test recipients are contacted", async () => {
  const s = setup([person(1), person(2)], { production: false, testRecipients: ["p2@example.com"] });
  const c = await draft(s);
  await scheduleCampaign(s.deps, c.id, null);
  await runCampaigns(s.deps);
  assert.deepEqual(s.mails.map((m) => m.to), ["p2@example.com"]);
  assert.equal([...s.recipients.values()].filter((r) => r.status === "skipped").length, 1);
});

test("a campaign that respects business hours waits for the office to open", async () => {
  const s = setup([person(1)], {}, NIGHT);
  const c = await saveCampaign(s.deps, null, { name: "Hours", channel: "email", subject: "Hello there", body: "Hi", audience: {}, respect_hours: true }, null);
  await scheduleCampaign(s.deps, c.id, null);
  await runCampaigns(s.deps);
  assert.equal(s.mails.length, 0);
  assert.equal(s.campaigns.get(c.id)!.status, "sending");
  await runCampaigns({ ...s.deps, now: () => NOON });
  assert.equal(s.mails.length, 1);
});

test("a configuration problem pauses the campaign and keeps the rest queued; transient errors retry up to three times", async () => {
  const s = setup([person(1), person(2)]);
  s.setMail(() => ({ ok: false, kind: "config", message: "Email is not configured." }));
  const c = await draft(s);
  await scheduleCampaign(s.deps, c.id, null);
  await runCampaigns(s.deps);
  assert.equal(s.campaigns.get(c.id)!.status, "paused");
  assert.equal([...s.recipients.values()].filter((r) => r.status === "queued").length, 2);

  const t = setup([person(1)]);
  t.setMail(() => ({ ok: false, kind: "transient", message: "busy" }));
  const c2 = await draft(t);
  await scheduleCampaign(t.deps, c2.id, null);
  for (let i = 0; i < 4; i++) await runCampaigns(t.deps);
  const r = [...t.recipients.values()][0];
  assert.equal(r.status, "failed");
  assert.equal(r.attempts, 3);
  assert.equal(t.campaigns.get(c2.id)!.status, "sent");
});

test("a campaign of texts goes only to people with text consent and carries the status callback", async () => {
  const s = setup([person(1), person(2, { bookingSms: true, booked: true, kind: "lead" })]);
  s.consents.push({ email: "p1@example.com", basis: "owner", sms_consent: true, revoked: false });
  const c = await draft(s, "sms");
  await scheduleCampaign(s.deps, c.id, null);
  await runCampaigns(s.deps);
  assert.equal(s.texts.length, 2);
  assert.ok(s.texts.every((t) => /Reply STOP/.test(t.body) && t.cb.includes("/api/sms/status/")));
  const lone = setup([person(3)]);
  const c3 = await draft(lone, "sms");
  await assert.rejects(scheduleCampaign(lone.deps, c3.id, null), /Nobody in this audience/);
});

test("scheduling is refused with no mailing address, and edits are refused after scheduling", async () => {
  const s = setup([person(1)]);
  const noAddress = { ...s.deps, office: async () => ({ ...(await s.deps.office()), address: null }) };
  const c = await draft(s);
  await assert.rejects(scheduleCampaign(noAddress, c.id, null), /mailing address/);
  await scheduleCampaign(s.deps, c.id, null);
  await assert.rejects(saveCampaign(s.deps, c.id, { name: "x", channel: "email", subject: "Hello there", body: "b", audience: {}, respect_hours: true }, null), /Only a draft/);
});

test("provider reports: delivery, hard bounce and complaint", async () => {
  const s = setup([person(1), person(2), person(3)]);
  const c = await draft(s);
  await scheduleCampaign(s.deps, c.id, null);
  await runCampaigns(s.deps);
  const [a, b, d] = [...s.recipients.values()];
  await mailDelivered(s.deps, a);
  await mailProblem(s.deps, b, "bounced");
  await mailProblem(s.deps, d, "complained");
  assert.deepEqual([a.status, b.status, d.status], ["delivered", "bounced", "complained"]);
  assert.equal(s.suppressions.get(`email|${b.address}`), "bounced");
  assert.equal(s.suppressions.get(`email|${d.address}`), "complaint");
});

test("text reports: delivered, failed, and an opted-out number is remembered", async () => {
  const s = setup([person(1)]);
  const c = await draft(s, "sms");
  s.consents.push({ email: "p1@example.com", basis: "owner", sms_consent: true, revoked: false });
  await scheduleCampaign(s.deps, c.id, null);
  await runCampaigns(s.deps);
  const r = [...s.recipients.values()][0];
  await textReport(s.deps, r, "delivered", null);
  assert.equal(r.status, "delivered");
  await textReport(s.deps, r, "undelivered", "21610");
  assert.equal(r.status, "failed");
  assert.equal(s.suppressions.get(`sms|${r.address}`), "stop");
});

test("STOP suppresses the number and START lifts only a STOP", async () => {
  const s = setup([]);
  await textKeyword(s.deps, "+15550101234", "stop");
  assert.ok((await s.repo.suppressed("sms")).has("+15550101234"));
  await s.repo.addSuppression("sms", "+15550109999", "bounced", null);
  await textKeyword(s.deps, "+15550101234", "start");
  await textKeyword(s.deps, "+15550109999", "start");
  const left = await s.repo.suppressed("sms");
  assert.ok(!left.has("+15550101234"));
  assert.ok(left.has("+15550109999"));
});

test("keywords", () => {
  for (const w of ["STOP", " stop.", "Unsubscribe", "CANCEL", "end", "QUIT", "stopall"]) assert.equal(keywordOf(w), "stop", w);
  assert.equal(keywordOf("START"), "start");
  assert.equal(keywordOf("Help"), "help");
  assert.equal(keywordOf("yes"), null);
  assert.equal(keywordOf("please stop texting me"), null);
});
