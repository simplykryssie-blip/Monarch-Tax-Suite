import test from "node:test";
import assert from "node:assert/strict";
import { PLATFORM_MAIL_FROM, sendSystemMail } from "../lib/platform-mail.ts";

const run = async (from?: string | null) => {
  const sent: { from?: string | null; replyTo?: string | null }[] = [];
  await sendSystemMail({ env: "production", testRecipients: [], from, send: async (m) => { sent.push({ from: m.from, replyTo: m.replyTo }); return { ok: true } as never; } }, "owner@firm.test", { subject: "Your Verexa HQ payment didn't go through", text: "Hi" });
  return sent[0];
};

test("platform billing mail is sent as Verexa HQ from the platform's own address, never as a workspace", async () => {
  const m = await run();
  assert.equal(m.from, PLATFORM_MAIL_FROM);
  assert.match(m.from ?? "", /^Verexa HQ <[^>]+@verexahq\.com>$/);
  assert.equal(m.replyTo, "support@verexahq.com");
});

test("an invalid from override is ignored and the Verexa HQ sender is used", async () => {
  assert.equal((await run("not a header"))?.from, PLATFORM_MAIL_FROM);
});
