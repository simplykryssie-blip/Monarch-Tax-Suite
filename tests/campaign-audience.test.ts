import assert from "node:assert/strict";
import test from "node:test";
import { exclusionSummary, resolveAudience, sanitizeFilter, EMPTY_FILTER, type AudienceContact, type AudienceContext, type ConsentRow } from "../lib/campaigns/audience.ts";
import { batchFor, healthOf, MIN_SAMPLE } from "../lib/campaigns/health.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const person = (n: number, over: Partial<AudienceContact> = {}): AudienceContact => ({ kind: "client", id: id(n), name: `Person ${n}`, email: `p${n}@example.com`, phone: `+1555010${String(1000 + n).slice(-4)}`, tags: [], status: null, archived: false, booked: false, bookingSms: false, ...over });
const ctx = (over: Partial<AudienceContext> = {}): AudienceContext => ({ channel: "email", consents: new Map(), suppressed: new Set(), platformBlocked: () => false, ...over });
const consent = (email: string, over: Partial<ConsentRow> = {}): [string, ConsentRow] => [email, { email, basis: "owner", sms_consent: false, revoked: false, ...over }];

test("clients are marketable automatically; leads need an opt-in or a booking", () => {
  const people = [person(1), person(2, { kind: "lead", status: "new" }), person(3, { kind: "lead", booked: true }), person(4, { kind: "lead" })];
  const consents = new Map([consent("p4@example.com", { basis: "form" })]);
  const r = resolveAudience([...people, person(5, { kind: "lead" })], EMPTY_FILTER, ctx({ consents }));
  assert.deepEqual(r.eligible.map((e) => e.id), [id(1), id(3), id(4)]);
  assert.equal(r.excluded.not_marketable, 2);
});

test("a revoked consent blocks everyone, even a client or a booking", () => {
  const consents = new Map([consent("p1@example.com", { revoked: true }), consent("p2@example.com", { revoked: true })]);
  const r = resolveAudience([person(1), person(2, { kind: "lead", booked: true })], EMPTY_FILTER, ctx({ consents }));
  assert.equal(r.eligible.length, 0);
  assert.equal(r.excluded.not_marketable, 2);
});

test("texts need the text-consent flag on top of marketing consent", () => {
  const consents = new Map([consent("p2@example.com", { sms_consent: true })]);
  const people = [person(1), person(2), person(3, { kind: "lead", booked: true, bookingSms: true }), person(4, { kind: "lead", booked: true })];
  const r = resolveAudience(people, EMPTY_FILTER, ctx({ channel: "sms", consents }));
  assert.deepEqual(r.eligible.map((e) => e.id), [id(2), id(3)]);
  assert.equal(r.excluded.no_text_consent, 2);
  assert.match(r.eligible[0].address, /^\+1/);
});

test("a lead with text consent but no marketing consent is still not texted", () => {
  const consents = new Map([consent("p9@example.com", { sms_consent: true, revoked: true })]);
  const r = resolveAudience([person(9, { kind: "lead" })], EMPTY_FILTER, ctx({ channel: "sms", consents }));
  assert.equal(r.eligible.length, 0);
});

test("unsubscribed, STOP, bounced and platform-blocked addresses are never in the audience", () => {
  const r = resolveAudience([person(1), person(2), person(3), person(4)], EMPTY_FILTER, ctx({ suppressed: new Set(["p2@example.com"]), platformBlocked: (a) => a === "p3@example.com" }));
  assert.deepEqual(r.eligible.map((e) => e.id), [id(1), id(4)]);
  assert.equal(r.excluded.suppressed, 1);
  assert.equal(r.excluded.blocked_everywhere, 1);
  const sms = resolveAudience([person(1)], EMPTY_FILTER, ctx({ channel: "sms", consents: new Map([consent("p1@example.com", { sms_consent: true })]), suppressed: new Set([resolveAudience([person(1)], EMPTY_FILTER, ctx({ channel: "sms", consents: new Map([consent("p1@example.com", { sms_consent: true })]) })).eligible[0].address]) }));
  assert.equal(sms.excluded.suppressed, 1, "a number that replied STOP is excluded");
});

test("suppression is by address and per office: another office's list is simply not passed in", () => {
  const officeA = resolveAudience([person(1)], EMPTY_FILTER, ctx({ suppressed: new Set(["p1@example.com"]) }));
  const officeB = resolveAudience([person(1)], EMPTY_FILTER, ctx({ suppressed: new Set() }));
  assert.equal(officeA.eligible.length, 0);
  assert.equal(officeB.eligible.length, 1);
});

test("filters: tags, status and kinds; archived people and missing addresses are counted", () => {
  const people = [
    person(1, { tags: ["vip", "2025"] }), person(2, { tags: ["2025"] }), person(3, { tags: ["vip", "unsubscribed-by-phone"] }),
    person(4, { kind: "lead", status: "new", booked: true }), person(5, { kind: "lead", status: "lost", booked: true }),
    person(6, { archived: true }), person(7, { email: null }), person(8, { email: "not an email" }),
  ];
  const f = (raw: unknown) => sanitizeFilter(raw);
  assert.deepEqual(resolveAudience(people, f({ tagsAny: ["vip"], tagsNone: ["unsubscribed-by-phone"] }), ctx()).eligible.map((e) => e.id), [id(1)]);
  assert.deepEqual(resolveAudience(people, f({ kinds: ["lead"], leadStatus: ["new"] }), ctx()).eligible.map((e) => e.id), [id(4)]);
  const all = resolveAudience(people, EMPTY_FILTER, ctx());
  assert.equal(all.excluded.archived, 1);
  assert.equal(all.excluded.no_address, 2);
  assert.equal(all.picked, 8);
});

test("a hand-picked list is exactly those people, still subject to consent", () => {
  const people = [person(1), person(2), person(3, { kind: "lead" })];
  const f = sanitizeFilter({ mode: "manual", picked: [{ kind: "client", id: id(1) }, { kind: "lead", id: id(3) }, { kind: "client", id: "not-a-uuid" }] });
  const r = resolveAudience(people, f, ctx());
  assert.deepEqual(r.eligible.map((e) => e.id), [id(1)]);
  assert.equal(r.excluded.not_marketable, 1);
});

test("one message per address", () => {
  const r = resolveAudience([person(1, { email: "same@example.com" }), person(2, { kind: "lead", booked: true, email: "SAME@example.com" })], EMPTY_FILTER, ctx());
  assert.equal(r.eligible.length, 1);
});

test("filter cleaning", () => {
  assert.deepEqual(sanitizeFilter(null), EMPTY_FILTER);
  assert.deepEqual(sanitizeFilter({ kinds: ["x"], tagsAny: " VIP , vip ,2025", leadStatus: ["new", "bogus"] }).tagsAny, ["vip", "2025"]);
  assert.deepEqual(sanitizeFilter({ kinds: ["x"], leadStatus: ["new", "bogus"] }).leadStatus, ["new"]);
  assert.throws(() => sanitizeFilter({ picked: Array.from({ length: 5001 }, () => ({ kind: "lead", id: id(1) })) }), /at most 5000/);
});

test("the summary says who was left out and why", () => {
  assert.deepEqual(exclusionSummary({ no_address: 0, archived: 0, not_marketable: 1, no_text_consent: 0, suppressed: 3, blocked_everywhere: 0 }), ["1 person: no marketing consent on record", "3 people: unsubscribed, replied STOP, bounced or complained"]);
});

test("health: good senders are never limited; bad ones are slowed, then stopped", () => {
  assert.equal(healthOf({ sent: 5000, bounced: 20, complained: 1 }).level, "ok");
  assert.equal(healthOf({ sent: MIN_SAMPLE - 1, bounced: 99, complained: 50 }).level, "ok", "too few sends to judge");
  assert.equal(healthOf({ sent: 1000, bounced: 40, complained: 0 }).level, "throttled");
  assert.equal(healthOf({ sent: 1000, bounced: 0, complained: 2 }).level, "throttled");
  assert.equal(healthOf({ sent: 1000, bounced: 90, complained: 0 }).level, "paused");
  assert.equal(healthOf({ sent: 1000, bounced: 0, complained: 4 }).level, "paused");
  assert.match(healthOf({ sent: 1000, bounced: 0, complained: 4 }).reason ?? "", /Spam complaints/);
  assert.equal(healthOf({ sent: 0, bounced: 0, complained: 0 }).level, "ok");
  assert.equal(batchFor("ok", 100), 100);
  assert.equal(batchFor("throttled", 100), 20);
  assert.equal(batchFor("throttled", 3), 1);
  assert.equal(batchFor("paused", 100), 0);
});
