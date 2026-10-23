import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { connectPlatformKey } from "../lib/connect/config.ts";
import { connectedUse, describeKey, resolveStoreStripe, type ConnectionFacts } from "../lib/store-stripe/keys.ts";

// The storefront's Stripe access: a connected Stripe account first (Stripe Connect, the click-to-connect path), then keys saved
// in the workspace's settings, then (Monarch only) the server's environment. The keys path stays as the permanent fallback.

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const PLATFORM_TEST = "sk_test_" + "P1atf0rmKeyAbCdEf1234567";
const PLATFORM_LIVE = "sk_live_" + "P1atf0rmKeyAbCdEf1234567";
const SAVED = { secretKey: "sk_test_" + "SavedKeyAbCdEfGh1234567", webhookSecret: "whsec_" + "SavedHookAbCdEfGh1234567890" };
const ENV = { STRIPE_SECRET_KEY: "sk_live_" + "EnvKeyAbCdEfGh1234567890", STRIPE_WEBHOOK_SECRET: "whsec_" + "EnvHookAbCdEfGh1234567890" };
const conn = (over: Partial<ConnectionFacts> = {}): ConnectionFacts => ({ accountId: "acct_1AbCdEfGh", livemode: false, status: "connected", chargesEnabled: true, ...over });

describe("when the connected account is used", () => {
  test("a connected account that can take payments is used, on Verexa's platform key, ahead of saved keys and the environment", () => {
    const r = resolveStoreStripe({ connection: conn(), platformKey: PLATFORM_TEST, saved: SAVED, env: ENV, isMonarch: true });
    assert.equal(r.secretKeySource, "connected");
    assert.equal(r.secretKey, PLATFORM_TEST);
    assert.equal(r.connectedAccount, "acct_1AbCdEfGh");
    assert.equal(r.mode, "test");
    assert.equal(r.connectionNote, null);
  });
  test("the webhook signing secret is still resolved on its own (saved, then environment), so a direct endpoint keeps working during a move", () => {
    assert.equal(resolveStoreStripe({ connection: conn(), platformKey: PLATFORM_TEST, saved: SAVED, env: ENV, isMonarch: true }).webhookSecret, SAVED.webhookSecret);
    const r = resolveStoreStripe({ connection: conn(), platformKey: PLATFORM_TEST, saved: null, env: ENV, isMonarch: true });
    assert.equal(r.webhookSecret, ENV.STRIPE_WEBHOOK_SECRET);
    assert.equal(r.webhookSecretSource, "environment");
  });
  test("a live connection on a live platform is live", () => {
    const r = resolveStoreStripe({ connection: conn({ livemode: true }), platformKey: PLATFORM_LIVE, saved: null, env: {}, isMonarch: false });
    assert.equal(r.mode, "live");
    assert.equal(r.secretKeySource, "connected");
  });
});

describe("when it falls back to the keys path, and says why", () => {
  const cases: [string, ConnectionFacts | null, string | null, RegExp | null][] = [
    ["no connection", null, PLATFORM_TEST, null],
    ["disconnected", conn({ status: "disconnected" }), PLATFORM_TEST, null],
    ["no platform key on this deployment", conn(), null, /no Stripe Connect platform key/],
    ["connected account is live, platform is test", conn({ livemode: true }), PLATFORM_TEST, /live.*test/],
    ["connected account is test, platform is live", conn({ livemode: false }), PLATFORM_LIVE, /test.*live/],
    ["the connected account cannot take payments yet", conn({ chargesEnabled: false }), PLATFORM_TEST, /can't take payments yet/],
  ];
  for (const [name, c, platformKey, note] of cases) {
    test(name, () => {
      const r = resolveStoreStripe({ connection: c, platformKey, saved: SAVED, env: ENV, isMonarch: true });
      assert.equal(r.secretKeySource, "settings", "saved keys win over the environment");
      assert.equal(r.secretKey, SAVED.secretKey);
      assert.equal(r.connectedAccount, null);
      if (note) assert.match(r.connectionNote ?? "", note);
      else assert.equal(r.connectionNote, null);
    });
  }
  test("with nothing saved, Monarch falls back to the environment and any other workspace to nothing", () => {
    assert.equal(resolveStoreStripe({ connection: null, platformKey: null, saved: null, env: ENV, isMonarch: true }).secretKeySource, "environment");
    const other = resolveStoreStripe({ connection: null, platformKey: PLATFORM_TEST, saved: null, env: ENV, isMonarch: false });
    assert.equal(other.secretKey, null);
    assert.equal(other.secretKeySource, null);
  });
  test("a workspace never borrows the platform key without its own usable connection", () => {
    for (const c of [null, conn({ status: "disconnected" }), conn({ chargesEnabled: false }), conn({ livemode: true })]) {
      assert.notEqual(resolveStoreStripe({ connection: c, platformKey: PLATFORM_TEST, saved: null, env: {}, isMonarch: false }).secretKey, PLATFORM_TEST);
    }
  });
  test("connectedUse reports the mode when usable", () => {
    assert.deepEqual(connectedUse(conn(), "test"), { usable: true, mode: "test" });
    assert.deepEqual(connectedUse(null, "test"), { usable: false, note: null });
  });
});

describe("the platform key", () => {
  test("is Verexa's Connect secret key when set and valid, and nothing otherwise", () => {
    assert.equal(connectPlatformKey({ STRIPE_CONNECT_SECRET_KEY: ` ${PLATFORM_TEST} ` }), PLATFORM_TEST);
    for (const bad of [undefined, "", "pk_test_x", "whsec_abc", "sk_prod_" + "a".repeat(24)]) assert.equal(connectPlatformKey({ STRIPE_CONNECT_SECRET_KEY: bad }), null, String(bad));
    assert.equal(connectPlatformKey({ STRIPE_SECRET_KEY: PLATFORM_TEST }), null, "the storefront's own key is never mistaken for the platform's");
  });
});

describe("what the screen says", () => {
  test("a connected account needs no key and says the saved keys are a fallback", () => {
    assert.match(describeKey("Secret key", "connected", null, "live"), /connected Stripe account is used \(live mode\).*fallback/);
  });
});

describe("wiring", () => {
  test("after Stripe's screen the person returns to the same base Stripe was sent to, not to wherever the deployment's own address points", () => {
    const route = src("app/api/stripe/connect/callback/route.ts");
    assert.match(route, /const origin = await connectBase\(\)/);
    assert.doesNotMatch(route, /appOrigin/);
    assert.match(src("lib/connect/redirect.ts"), /STRIPE_CONNECT_REDIRECT_BASE \|\| \(await appOrigin\(\)\)/);
  });
  test("the client names the connected account on every call, only when connected", () => {
    const server = src("lib/store-stripe/server.ts");
    assert.match(server, /new Stripe\(r\.secretKey, r\.connectedAccount \? \{ stripeAccount: r\.connectedAccount \} : undefined\)/);
    assert.match(server, /connectPlatformKey\(process\.env\)/);
    assert.doesNotMatch(server, /STRIPE_CONNECT_SECRET_KEY/);
  });
  test("there is no platform fee anywhere: no application fee, transfer or on-behalf-of on any Stripe call", () => {
    for (const f of ["lib/connect/stripe-port.ts", "lib/connect/service.ts", "lib/store-stripe/server.ts", "lib/stripe-catalog.ts"]) {
      assert.doesNotMatch(src(f), /application_fee|transfer_data|on_behalf_of/, f);
    }
  });
  test("the store screen's connect actions re-check access, return to the store screen, and never carry a key", () => {
    const actions = src("app/(admin)/settings/store-payments/actions.ts");
    assert.match(actions, /back: "store-payments"/);
    assert.match(actions, /disconnectStoreStripeAction[\s\S]*form\.get\("confirm"\) !== "on"/);
    const page = src("app/(admin)/settings/store-payments/page.tsx");
    assert.match(page, /connectStoreStripeAction/);
    assert.match(page, /Or use your own keys/);
    assert.doesNotMatch(page.replace(/st\.secretKeySource|st\.webhookSecretSource|st\.secretKeyHint|st\.webhookSecretHint/g, ""), /secretKey|webhookSecret\b/);
  });
});
