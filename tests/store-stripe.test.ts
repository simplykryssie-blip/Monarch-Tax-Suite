import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { CrmSecrets } from "../lib/crm/crypto.ts";
import { describeKey, judgeProductLookups, keyHint, modeOfKey, parseSecretKey, parseWebhookSecret, resolveKeys } from "../lib/store-stripe/keys.ts";

// A workspace's storefront Stripe keys live in its own settings (encrypted). Only Monarch may still fall back to the server's
// environment while the move is made, and no page or log ever carries a key.

const TEST_KEY = "sk_test_" + "a1B2c3D4e5F6g7H8i9J0kLmN";
const LIVE_KEY = "rk_live_" + "Zz9Yy8Xx7Ww6Vv5Uu4Tt3Ss2";
const HOOK = "whsec_" + "AbCdEfGhIjKlMnOpQrStUvWx1234567890";

describe("key rules", () => {
  test("a secret or restricted key is accepted, with its mode and last four characters", () => {
    const t = parseSecretKey(`  ${TEST_KEY}  `);
    assert.ok(t.ok);
    assert.equal(t.ok && t.mode, "test");
    assert.equal(t.ok && t.hint, TEST_KEY.slice(-4));
    const l = parseSecretKey(LIVE_KEY);
    assert.ok(l.ok && l.mode === "live");
  });

  test("a publishable key, junk, empty, or a webhook secret is refused with a plain reason", () => {
    assert.match((parseSecretKey("pk_test_" + "a".repeat(24)) as { error: string }).error, /publishable/);
    for (const bad of ["", "   ", "sk_test_short", "hello", `${TEST_KEY} extra`, "sk_prod_" + "a".repeat(24), HOOK, null, undefined, 42]) {
      assert.equal(parseSecretKey(bad).ok, false, String(bad));
    }
  });

  test("a webhook signing secret must look like one", () => {
    assert.ok(parseWebhookSecret(HOOK).ok);
    for (const bad of ["", "whsec_x", TEST_KEY, "whsec_" + "a".repeat(10), null]) assert.equal(parseWebhookSecret(bad).ok, false, String(bad));
  });

  test("mode comes from the key's prefix", () => {
    assert.equal(modeOfKey(TEST_KEY), "test");
    assert.equal(modeOfKey(LIVE_KEY), "live");
    assert.equal(modeOfKey("pk_test_x"), null);
    assert.equal(modeOfKey(null), null);
    assert.equal(keyHint("abcdefgh"), "efgh");
  });
});

describe("where the keys come from", () => {
  const env = { STRIPE_SECRET_KEY: TEST_KEY, STRIPE_WEBHOOK_SECRET: HOOK };

  test("saved settings win over the environment", () => {
    const r = resolveKeys({ secretKey: LIVE_KEY, webhookSecret: null }, env, true);
    assert.equal(r.secretKey, LIVE_KEY);
    assert.equal(r.secretKeySource, "settings");
    assert.equal(r.webhookSecret, HOOK, "an unsaved webhook secret still falls back for Monarch");
    assert.equal(r.webhookSecretSource, "environment");
  });

  test("Monarch falls back to the environment until its keys are saved", () => {
    const r = resolveKeys(null, env, true);
    assert.deepEqual([r.secretKey, r.secretKeySource, r.webhookSecretSource], [TEST_KEY, "environment", "environment"]);
  });

  test("no other workspace ever borrows the environment's keys", () => {
    const r = resolveKeys(null, env, false);
    assert.deepEqual([r.secretKey, r.webhookSecret, r.secretKeySource, r.webhookSecretSource], [null, null, null, null]);
    const own = resolveKeys({ secretKey: LIVE_KEY, webhookSecret: HOOK }, env, false);
    assert.equal(own.secretKey, LIVE_KEY);
  });

  test("with nothing anywhere, nothing is set", () => {
    const r = resolveKeys(null, {}, true);
    assert.equal(r.secretKey, null);
    assert.equal(r.secretKeySource, null);
  });

  test("the owner-facing lines never include a key", () => {
    for (const line of [describeKey("Secret key", "settings", "x9Z1", "live"), describeKey("Secret key", "environment", null, "test"), describeKey("Secret key", null, null, null)]) {
      assert.ok(!line.includes(TEST_KEY) && !line.includes(LIVE_KEY) && !/sk_|rk_|whsec_/.test(line), line);
    }
    assert.match(describeKey("Secret key", "settings", "x9Z1", "live"), /ends x9Z1.*live mode/);
    assert.match(describeKey("Secret key", "environment", null, "test"), /remove it from Vercel/);
    assert.match(describeKey("Secret key", null, null, null), /not set/);
  });
});

describe("is it the right Stripe account", () => {
  test("a key that can't see the store's own products is reported as the wrong account or mode", () => {
    const r = judgeProductLookups(["missing", "missing"]);
    assert.equal(r.ok, false);
    assert.match(r.message, /different Stripe account \(or the other mode/);
    assert.equal(judgeProductLookups(["found", "missing"]).ok, false, "one missing price is enough to refuse");
  });

  test("found products confirm it; no products or a lookup hiccup never block a working key", () => {
    assert.deepEqual(judgeProductLookups(["found", "found"]), { ok: true, message: " It also found your store's products." });
    assert.deepEqual(judgeProductLookups([]), { ok: true, message: "" });
    const hiccup = judgeProductLookups(["error", "found"]);
    assert.ok(hiccup.ok);
    assert.match(hiccup.message, /couldn't be checked/);
  });
});

describe("encryption binds a key to its workspace and field", () => {
  const secrets = new CrmSecrets(Buffer.alloc(32, 7));
  const aad = (tenant: string, field: string) => `tenant_store_stripe:${tenant}:${field}`;

  test("round trip works; another workspace or field cannot read it", () => {
    const enc = secrets.encrypt(TEST_KEY, aad("tenant-a", "secret_key"));
    assert.ok(enc.startsWith("v1:"), "matches the table's ciphertext check");
    assert.ok(!enc.includes(TEST_KEY));
    assert.equal(secrets.decrypt(enc, aad("tenant-a", "secret_key")), TEST_KEY);
    assert.throws(() => secrets.decrypt(enc, aad("tenant-b", "secret_key")));
    assert.throws(() => secrets.decrypt(enc, aad("tenant-a", "webhook_secret")));
  });
});

describe("wiring", () => {
  const root = new URL("..", import.meta.url).pathname;
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (n === "node_modules" || n === ".next") return [];
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
  const files = ["app", "lib", "components"].flatMap((d) => walk(join(root, d)));
  const read = (p: string) => readFileSync(p, "utf8");

  test("only the key rules read the server-wide Stripe variables", () => {
    const readers = files.filter((f) => /process\.env\.STRIPE_(SECRET_KEY|WEBHOOK_SECRET)\b|\.STRIPE_(SECRET_KEY|WEBHOOK_SECRET)\b(?!\w)/.test(read(f).replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, ""))).map((f) => f.slice(root.length));
    assert.deepEqual(readers, ["lib/store-stripe/keys.ts"]);
  });

  test("the old synchronous client is gone", () => {
    assert.ok(!files.some((f) => /\bstripeClient\b/.test(read(f))));
  });

  test("the webhook takes its keys from the workspace's settings", () => {
    const hook = read(join(root, "app/api/stripe/webhook/route.ts"));
    assert.match(hook, /loadStoreStripe\(\)/);
    assert.ok(!/process\.env/.test(hook));
  });

  test("every use of the catalog port or client is awaited", () => {
    for (const f of files) {
      const src = read(f).replace(/export async function stripeCatalogPort\(\)/, "").replace(/export async function storeStripeClient\(/, "");
      assert.ok(!/(?<!await )(?<!\()stripeCatalogPort\(\)/.test(src.replace(/\(await stripeCatalogPort\(\)\)/g, "")), `${f}: unawaited stripeCatalogPort()`);
      assert.ok(!/(?<!await )storeStripeClient\(\)/.test(src.replace(/\(await storeStripeClient\(\)\)/g, "")), `${f}: unawaited storeStripeClient()`);
    }
  });

  test("the store payments pages are for the store section, and nothing returns a key to the page", () => {
    const page = read(join(root, "app/(admin)/settings/store-payments/page.tsx"));
    const actions = read(join(root, "app/(admin)/settings/store-payments/actions.ts"));
    assert.match(page, /requireSection\("store"\)/);
    assert.equal((actions.match(/requireSection\("store"\)/g) ?? []).length, 3);
    assert.ok(!/secretKey|webhookSecret\b/.test(page.replace(/st\.secretKeySource|st\.webhookSecretSource|st\.secretKeyHint|st\.webhookSecretHint/g, "")), "the page reads only sources, hints and mode");
    assert.ok(/type="password"/.test(page));
  });

  test("the migration is additive, has the ciphertext check and the tenant policies", () => {
    const sql = read(join(root, "supabase/migrations/20261118100000_tenant_store_stripe.sql")).replace(/--.*$/gm, "");
    assert.ok(!/drop |truncate|delete from/i.test(sql));
    assert.match(sql, /secret_key_enc text not null check \(secret_key_enc like 'v1:%'\)/);
    assert.match(sql, /tenant_isolation/);
    assert.match(sql, /tenant_members_only/);
    assert.match(sql, /revoke all on table public\.%I from anon, authenticated/);
  });
});
