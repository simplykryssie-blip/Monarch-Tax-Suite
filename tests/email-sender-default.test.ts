import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MemoryAutomationRepo } from "./automation-memory.ts";
import { sendSenderTest } from "../lib/automation/admin.ts";
import type { SendersRepo, SenderRow, EmailDomainRow } from "../lib/automation/senders.ts";
import { emailConfig, emailKeyProblems, ResendEmailSender, withDefaultSender, type EmailMessage, type EmailSender, type SendResult } from "../lib/automation/email.ts";

// Email no longer depends on an environment "from" address: each email carries its own sender, or the workspace's saved default.
// Fake keys and addresses only.

const base: EmailMessage = { to: "person@example.com", subject: "s", html: "<p>h</p>", text: "t", idempotencyKey: "k1" };
const recorder = () => {
  const sent: EmailMessage[] = [];
  const sender: EmailSender = { send: async (m): Promise<SendResult> => (sent.push(m), { ok: true, id: "id1" }) };
  return { sent, sender };
};

describe("the key is needed; the environment address is not", () => {
  test("emailKeyProblems only asks for the key", () => {
    assert.equal(emailKeyProblems(emailConfig({})).length, 1);
    assert.deepEqual(emailKeyProblems(emailConfig({ RESEND_API_KEY: "re_fake" })), []);
  });
  test("an email that carries its own from is sent with no MONARCH_EMAIL_FROM set", async () => {
    let body = "";
    const fakeFetch = (async (_u: unknown, init: RequestInit) => ((body = String(init.body)), new Response(JSON.stringify({ id: "x1" }), { status: 200 }))) as typeof fetch;
    const s = new ResendEmailSender(emailConfig({ RESEND_API_KEY: "re_fake" }), fakeFetch);
    const r = await s.send({ ...base, from: '"Fake Firm" <hello@example.com>' });
    assert.equal(r.ok, true);
    assert.match(body, /"from":"\\"Fake Firm\\" <hello@example.com>"/);
  });
  test("an email with no from and no environment address is refused in plain words, not sent", async () => {
    let called = false;
    const fakeFetch = (async () => ((called = true), new Response("{}", { status: 200 }))) as typeof fetch;
    const r = await new ResendEmailSender(emailConfig({ RESEND_API_KEY: "re_fake" }), fakeFetch).send(base);
    assert.equal(r.ok, false);
    assert.equal(called, false);
  });
  test("the environment address still works as the last resort", async () => {
    const fakeFetch = (async () => new Response(JSON.stringify({ id: "x2" }), { status: 200 })) as typeof fetch;
    const r = await new ResendEmailSender(emailConfig({ RESEND_API_KEY: "re_fake", MONARCH_EMAIL_FROM: "Fake <a@example.com>" }), fakeFetch).send(base);
    assert.equal(r.ok, true);
  });
});

describe("withDefaultSender", () => {
  test("fills in the workspace's default sender and its reply-to", async () => {
    const { sent, sender } = recorder();
    await withDefaultSender(sender, async () => ({ from: '"Fake Firm" <support@example.com>', replyTo: "support@example.com" })).send(base);
    assert.equal(sent[0].from, '"Fake Firm" <support@example.com>');
    assert.equal(sent[0].replyTo, "support@example.com");
  });
  test("an email that names its own sender is left alone", async () => {
    const { sent, sender } = recorder();
    let asked = false;
    await withDefaultSender(sender, async () => ((asked = true), { from: "x <x@example.com>", replyTo: null })).send({ ...base, from: "Own <own@example.com>", replyTo: "r@example.com" });
    assert.equal(asked, false);
    assert.equal(sent[0].from, "Own <own@example.com>");
  });
  test("no sender set up: not sent, and the reason is in words", async () => {
    const { sent, sender } = recorder();
    const r = await withDefaultSender(sender, async () => { throw new Error("There is no verified sending address yet. Connect your domain in Settings → Email sending."); }).send(base);
    assert.equal(sent.length, 0);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.message, /sending address/);
  });
});

describe("wiring", () => {
  const read = (f: string) => readFileSync(f, "utf8");
  test("EFIN renewals, template tests and texting notices no longer lean on the environment address", () => {
    assert.match(read("lib/efin/renewals.ts"), /tenantEmailSender\(\)/);
    assert.match(read("app/(admin)/automation/actions.ts"), /tenantEmailSender\(\)/);
    const sms = read("lib/sms/server.ts");
    assert.match(sms, /sendPlatformEmail\(/);
    assert.ok(!/ResendEmailSender/.test(sms));
  });
  test("the platform's own mail still never reads the Monarch sender settings", () => {
    assert.ok(!/MONARCH_EMAIL_FROM|MONARCH_EMAIL_REPLY_TO|senderFor|fallbackSender/.test(read("lib/platform-mail.ts") + read("lib/platform-mail-server.ts")));
  });
});

describe("sender test-send", () => {
  const domain = { id: "d1", domain: "example.com", status: "verified" } as EmailDomainRow;
  const sender = { id: "s1", domain_id: "d1", from_name: "Fake Firm", local_part: "support", reply_to: "support@example.com", is_default: true, archived_at: null } as SenderRow;
  const senders = { getSender: async (id: string) => (id === "s1" ? sender : null), getDomain: async () => domain, listSenders: async () => [sender] } as unknown as SendersRepo;
  const actor = { id: "admin-1", email: "admin@example.com" };

  test("sends one message to the administrator only, from the chosen sender", async () => {
    const { sent, sender: email } = recorder();
    const label = await sendSenderTest(new MemoryAutomationRepo(), senders, email, actor, "s1");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "admin@example.com");
    assert.equal(sent[0].from, '"Fake Firm" <support@example.com>');
    assert.equal(sent[0].replyTo, "support@example.com");
    assert.match(sent[0].subject, /^\[TEST\]/);
    assert.match(label, /support@example\.com/);
  });
  test("a removed sender or an unverified domain is refused before anything is sent", async () => {
    const { sent, sender: email } = recorder();
    await assert.rejects(sendSenderTest(new MemoryAutomationRepo(), senders, email, actor, "gone"), /removed/);
    const pending = { ...senders, getDomain: async () => ({ ...domain, status: "pending" }) } as unknown as SendersRepo;
    await assert.rejects(sendSenderTest(new MemoryAutomationRepo(), pending, email, actor, "s1"), /not verified/);
    assert.equal(sent.length, 0);
  });
  test("limited to ten a hour", async () => {
    const { sender: email } = recorder();
    const repo = new MemoryAutomationRepo();
    for (let i = 0; i < 10; i++) await sendSenderTest(repo, senders, email, actor, "s1");
    await assert.rejects(sendSenderTest(repo, senders, email, actor, "s1"), /Too many/);
  });
});
