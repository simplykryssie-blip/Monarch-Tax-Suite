import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { checkRate, clientAddress, hashClient, LIMIT_PER_CLIENT, LIMIT_PER_EMBED, windowStart, type RateLimitStore } from "../lib/commerce/rate-limit.ts";
import { isTopLevelNavigation, publicReason, decideEmbed } from "../lib/commerce/embed.ts";

/** In-memory stand-in for the Postgres counters: persists across calls like the database does. */
function memoryStore(): RateLimitStore & { counts: Map<string, number> } {
  const counts = new Map<string, number>();
  return {
    counts,
    async hit(bucket, start) {
      const k = `${bucket}|${start}`;
      const n = (counts.get(k) ?? 0) + 1;
      counts.set(k, n);
      return n;
    },
  };
}

const NOW = Date.parse("2026-10-09T15:00:20Z");
const EMBED = "emb_" + "a".repeat(22);

describe("license validation rate limiting", () => {
  test("legitimate repeated validation is allowed up to the limit, then refused with Retry-After", async () => {
    const store = memoryStore();
    const clientHash = hashClient("203.0.113.9", "k");
    for (let i = 0; i < LIMIT_PER_CLIENT; i++) assert.equal((await checkRate(store, { clientHash, embedId: EMBED, nowMs: NOW })).allowed, true);
    const blocked = await checkRate(store, { clientHash, embedId: EMBED, nowMs: NOW });
    assert.equal(blocked.allowed, false);
    if (!blocked.allowed) {
      assert.equal(blocked.scope, "client");
      assert.equal(blocked.retryAfterSeconds, 40);
    }
  });

  test("the limit resets in the next window", async () => {
    const store = memoryStore();
    const clientHash = hashClient("203.0.113.9", "k");
    for (let i = 0; i <= LIMIT_PER_CLIENT; i++) await checkRate(store, { clientHash, embedId: null, nowMs: NOW });
    assert.equal((await checkRate(store, { clientHash, embedId: null, nowMs: NOW })).allowed, false);
    assert.equal((await checkRate(store, { clientHash, embedId: null, nowMs: NOW + 60_000 })).allowed, true);
  });

  test("one abusive address does not block other visitors sharing the same license", async () => {
    const store = memoryStore();
    const abuser = hashClient("198.51.100.1", "k");
    for (let i = 0; i <= LIMIT_PER_CLIENT + 5; i++) await checkRate(store, { clientHash: abuser, embedId: EMBED, nowMs: NOW });
    const other = await checkRate(store, { clientHash: hashClient("198.51.100.2", "k"), embedId: EMBED, nowMs: NOW });
    assert.equal(other.allowed, true);
  });

  test("a flood spread across many addresses is stopped by the per-embed limit", async () => {
    const store = memoryStore();
    let blockedAt = -1;
    for (let i = 0; i < LIMIT_PER_EMBED + 50; i++) {
      const r = await checkRate(store, { clientHash: hashClient(`10.0.${Math.floor(i / 200)}.${i % 200}`, "k"), embedId: EMBED, nowMs: NOW });
      if (!r.allowed) {
        blockedAt = i;
        assert.equal(r.scope, "embed");
        break;
      }
    }
    assert.equal(blockedAt, LIMIT_PER_EMBED);
  });

  test("fails open when the counter store is unavailable, and reports only a reason code", async () => {
    const reasons: string[] = [];
    const broken: RateLimitStore = { hit: async () => { throw new Error("secret detail that must not be reported"); } };
    const result = await checkRate(broken, { clientHash: "h", embedId: EMBED, nowMs: NOW, onError: (r) => reasons.push(r) });
    assert.equal(result.allowed, true);
    assert.deepEqual(reasons, ["rate_limit_store_unavailable"]);
  });

  test("client addresses are hashed, never stored, and keyed when a key exists", () => {
    const a = hashClient("203.0.113.9", "key-one");
    assert.match(a, /^[0-9a-f]{64}$/);
    assert.ok(!a.includes("203"));
    assert.notEqual(a, hashClient("203.0.113.9", "key-two"));
    assert.notEqual(a, hashClient("203.0.113.9", null));
    assert.equal(hashClient("203.0.113.9", "key-one"), a);
  });

  test("the client address comes from the first x-forwarded-for entry only", () => {
    assert.equal(clientAddress("203.0.113.9, 70.41.3.18, 150.172.238.178"), "203.0.113.9");
    assert.equal(clientAddress(null), null);
    assert.equal(clientAddress(""), null);
    assert.equal(clientAddress("x".repeat(100)), null);
  });

  test("window boundaries are minute-aligned", () => {
    const w = windowStart(Date.parse("2026-10-09T15:00:20Z"));
    assert.equal(w.startIso, "2026-10-09T15:00:00.000Z");
    assert.equal(w.retryAfterSeconds, 40);
  });
});

describe("license validation responses and direct visits", () => {
  const license = (status: string) => ({ id: "l1", status }) as never;
  const domain = { domain: "client.example", status: "active" } as never;

  test("unknown, inactive and domain-less licenses are indistinguishable to the caller", () => {
    const notFound = decideEmbed(null, [], "client.example");
    const inactive = decideEmbed(license("revoked"), [domain], "client.example");
    const noDomains = decideEmbed(license("active"), [], "client.example");
    for (const d of [notFound, inactive, noDomains]) {
      assert.equal(d.ok, false);
      if (!d.ok) assert.equal(publicReason(d.reason), "unavailable");
    }
  });

  test("an unauthorized domain is still reported so an integrator can fix it", () => {
    const d = decideEmbed(license("active"), [domain], "other.example");
    assert.equal(d.ok, false);
    if (!d.ok) assert.equal(publicReason(d.reason), "domain_not_authorized");
  });

  test("revoked and suspended licenses never validate; an active licensed domain does", () => {
    assert.equal(decideEmbed(license("revoked"), [domain], "client.example").ok, false);
    assert.equal(decideEmbed(license("suspended"), [domain], "client.example").ok, false);
    assert.equal(decideEmbed(license("active"), [domain], "client.example").ok, true);
    assert.equal(decideEmbed(license("active"), [domain], "www.client.example").ok, true);
  });

  test("opening the embed URL directly in a tab is refused; frames and unknown browsers are not", () => {
    assert.equal(isTopLevelNavigation("document"), true);
    assert.equal(isTopLevelNavigation("DOCUMENT"), true);
    assert.equal(isTopLevelNavigation("iframe"), false);
    assert.equal(isTopLevelNavigation(null), false);
    assert.equal(isTopLevelNavigation(undefined), false);
  });
});
