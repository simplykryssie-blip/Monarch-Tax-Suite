import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { interpretResendEvent, verifySvix } from "../lib/campaigns/webhook.ts";

const secret = `whsec_${Buffer.from("a-secret-for-tests-0123456789abcd").toString("base64")}`;
const sign = (id: string, ts: string, body: string) => `v1,${createHmac("sha256", Buffer.from(secret.slice(6), "base64")).update(`${id}.${ts}.${body}`).digest("base64")}`;
const NOW = 1_800_000_000_000;
const ts = String(NOW / 1000);

test("a correctly signed, fresh webhook verifies", () => {
  const body = '{"type":"email.delivered"}';
  assert.ok(verifySvix({ secret, id: "msg_1", timestamp: ts, signature: sign("msg_1", ts, body), body, nowMs: NOW }));
  assert.ok(verifySvix({ secret, id: "msg_1", timestamp: ts, signature: `v1,AAAA ${sign("msg_1", ts, body)}`, body, nowMs: NOW }));
});

test("tampered, stale, missing or wrong-secret webhooks are refused", () => {
  const body = '{"type":"email.delivered"}';
  const good = sign("msg_1", ts, body);
  assert.ok(!verifySvix({ secret, id: "msg_1", timestamp: ts, signature: good, body: body + " ", nowMs: NOW }));
  assert.ok(!verifySvix({ secret, id: "msg_1", timestamp: ts, signature: good, body, nowMs: NOW + 10 * 60_000 }));
  assert.ok(!verifySvix({ secret, id: null, timestamp: ts, signature: good, body, nowMs: NOW }));
  assert.ok(!verifySvix({ secret: "whsec_" + Buffer.from("different-secret-different-secret").toString("base64"), id: "msg_1", timestamp: ts, signature: good, body, nowMs: NOW }));
});

test("only deliveries, permanent bounces and complaints are acted on", () => {
  assert.deepEqual(interpretResendEvent({ type: "email.delivered", data: { email_id: "e1" } }), { kind: "delivered", emailId: "e1" });
  assert.deepEqual(interpretResendEvent({ type: "email.complained", data: { email_id: "e2" } }), { kind: "complaint", emailId: "e2" });
  assert.deepEqual(interpretResendEvent({ type: "email.bounced", data: { email_id: "e3", bounce: { type: "Permanent" } } }), { kind: "hard_bounce", emailId: "e3" });
  assert.equal(interpretResendEvent({ type: "email.bounced", data: { email_id: "e4", bounce: { type: "Transient" } } }), null);
  assert.equal(interpretResendEvent({ type: "email.opened", data: { email_id: "e5" } }), null);
  assert.equal(interpretResendEvent({ type: "email.delivered", data: {} }), null);
  assert.equal(interpretResendEvent(null), null);
});
