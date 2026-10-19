import assert from "node:assert/strict";
import test from "node:test";
import { TwilioAccounts } from "../lib/automation/twilio.ts";

const recorder = () => {
  const calls: { url: string; method: string; body: string }[] = [];
  const fetchImpl = (async (url: string, init: { method: string; body?: string }) => {
    calls.push({ url, method: init.method, body: init.body ?? "" });
    return new Response(JSON.stringify({ sid: "PN1", phone_number: "+15550100000", incoming_phone_numbers: [{ sid: "PN1", sms_url: "https://old.example/x" }] }), { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, twilio: new TwilioAccounts({ username: "u", password: "p" }, fetchImpl) };
};

test("a number is bought with its incoming-text address already set", async () => {
  const { calls, twilio } = recorder();
  await twilio.buyNumber("ACsub", "+15550100000", "https://app.example/api/sms/inbound/sig");
  const form = new URLSearchParams(calls[0].body);
  assert.equal(form.get("SmsUrl"), "https://app.example/api/sms/inbound/sig");
  assert.equal(form.get("SmsMethod"), "POST");
  await twilio.buyNumber("ACsub", "+15550100001");
  assert.equal(new URLSearchParams(calls[1].body).has("SmsUrl"), false);
});

test("an existing number can be pointed at the address and found by its number", async () => {
  const { calls, twilio } = recorder();
  await twilio.setNumberInbound("ACsub", "PN1", "https://app.example/api/sms/inbound/sig");
  assert.match(calls[0].url, /Accounts\/ACsub\/IncomingPhoneNumbers\/PN1\.json$/);
  assert.equal(new URLSearchParams(calls[0].body).get("SmsUrl"), "https://app.example/api/sms/inbound/sig");
  assert.deepEqual(await twilio.findNumberSid("ACsub", "+15550100000"), { sid: "PN1", smsUrl: "https://old.example/x" });
});
