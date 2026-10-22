import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PLATFORM_MAIL_FROM, sendSystemMail, type SystemMailDeps } from "../lib/platform-mail.ts";
import type { EmailMessage, SendResult } from "../lib/automation/email.ts";

// Platform emails come from the platform's own address, never through a workspace's sending setup.

function deps(over: Partial<SystemMailDeps> = {}, result: SendResult = { ok: true, id: "e1" }) {
  const sent: EmailMessage[] = [];
  const d: SystemMailDeps = { env: "production", testRecipients: [], send: async (m) => { sent.push(m); return result; }, ...over };
  return { d, sent };
}
const mail = { subject: "Welcome to Verexa HQ", text: "Hi Pat,\n\nYour workspace is ready.\n\nhttps://app.verexahq.com/practice/invite/abc", action: { label: "Set my password", url: "https://app.verexahq.com/practice/invite/abc" } };

describe("platform system mail", () => {
  test("goes out from support@verexahq.com with that address as the reply-to", async () => {
    const { d, sent } = deps();
    assert.equal(await sendSystemMail(d, "owner@example.com", mail), null);
    assert.equal(PLATFORM_MAIL_FROM, "Verexa HQ <support@verexahq.com>");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].from, PLATFORM_MAIL_FROM);
    assert.equal(sent[0].replyTo, "support@verexahq.com");
    assert.equal(sent[0].to, "owner@example.com");
    assert.match(sent[0].html, /Set my password/);
    assert.equal(sent[0].subject, mail.subject);
  });

  test("never uses Monarch's address", async () => {
    const { d, sent } = deps();
    await sendSystemMail(d, "owner@example.com", mail);
    assert.ok(!/monarch/i.test(`${sent[0].from} ${sent[0].replyTo}`));
  });

  test("outside production only the test list is emailed (case-insensitive), and the reason is plain", async () => {
    const { d, sent } = deps({ env: "preview", testRecipients: ["Tester@Example.com"] });
    assert.equal(await sendSystemMail(d, "tester@example.com", mail), null);
    assert.equal(sent.length, 1);
    const held = await sendSystemMail(d, "someone@else.com", mail);
    assert.match(held ?? "", /Preview deployment only emails addresses listed in AUTOMATION_TEST_RECIPIENTS.*someone@else\.com/);
    assert.equal(sent.length, 1, "a held-back email is never sent");
  });

  test("production does not apply the test list", async () => {
    const { d, sent } = deps({ env: "production", testRecipients: ["only@example.com"] });
    assert.equal(await sendSystemMail(d, "anyone@example.com", mail), null);
    assert.equal(sent.length, 1);
  });

  test("a valid override of the from header is used; an invalid one falls back", async () => {
    const ok = deps({ from: "Verexa HQ <billing@verexahq.com>" });
    await sendSystemMail(ok.d, "a@example.com", mail);
    assert.equal(ok.sent[0].from, "Verexa HQ <billing@verexahq.com>");
    const bad = deps({ from: "not an address\r\nBcc: x@y.z" });
    await sendSystemMail(bad.d, "a@example.com", mail);
    assert.equal(bad.sent[0].from, PLATFORM_MAIL_FROM);
  });

  test("a failed send returns why, without a key", async () => {
    const { d } = deps({}, { ok: false, kind: "permanent", message: "The recipient email address is not valid. key=re_abcdefghijklmnopqrstuvwxyz0123456789" });
    const why = await sendSystemMail(d, "x", mail);
    assert.ok(why && why.length > 0);
    assert.ok(!/re_abcdefghijklmnopqrstuvwxyz0123456789/.test(why), "keys are scrubbed");
  });

  test("the same email gets the same idempotency key; a different one does not", async () => {
    const a = deps(); await sendSystemMail(a.d, "a@example.com", mail); await sendSystemMail(a.d, "a@example.com", mail);
    assert.equal(a.sent[0].idempotencyKey, a.sent[1].idempotencyKey);
    await sendSystemMail(a.d, "a@example.com", { ...mail, subject: "Reminder" });
    assert.notEqual(a.sent[0].idempotencyKey, a.sent[2].idempotencyKey);
  });
});

describe("platform mail wiring", () => {
  const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

  test("billing emails use the platform sender, not a workspace's", () => {
    const billing = read("lib/billing/server.ts");
    assert.match(billing, /mail: \(to, mail\) => sendPlatformEmail\(to, mail\)/);
    assert.ok(!/sendOfficeEmail/.test(billing));
    assert.ok(!/MONARCH_TENANT_ID/.test(billing));
  });

  test("the new-workspace invite uses the platform sender", () => {
    const actions = read("app/(admin)/admin/workspaces/actions.ts");
    assert.match(actions, /sendPlatformEmail\(member\.email,/);
    assert.ok(!/sendPracticeEmail/.test(actions));
  });

  test("the platform sender does not read the Monarch sender settings", () => {
    const mailFile = read("lib/platform-mail.ts") + read("lib/platform-mail-server.ts");
    assert.ok(!/MONARCH_EMAIL_FROM|MONARCH_EMAIL_REPLY_TO|MONARCH_TENANT_ID|senderFor|fallbackSender/.test(mailFile));
  });
});
