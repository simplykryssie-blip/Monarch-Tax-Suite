import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { dispatchConnectEvent, routeConnectedEvent, STORE_EVENT_TYPES, type DispatchDeps, type RoutableEvent } from "../lib/connect/dispatch.ts";

// One Connect webhook serves two uses of the same connection: an invoice paid by a client, and a sale in the store. Each event
// goes to exactly one handler, and an account that isn't one of ours is acknowledged and left alone.

const ev = (type: string, metadata: Record<string, string> | null = null, account: string | undefined = "acct_1Mine"): RoutableEvent => ({ id: `evt_${type}`, type, livemode: false, account, data: { object: { metadata } } });
const INVOICE_META = { invoice_payment_id: "pay-1", invoice_id: "inv-1", tenant_id: "t-1" };

describe("routing", () => {
  test("account changes belong to the connection", () => {
    for (const t of ["account.updated", "account.application.deauthorized"]) assert.equal(routeConnectedEvent(ev(t)), "connection");
  });
  test("anything carrying an invoice payment's mark is an invoice event, including its payment intent and charge", () => {
    for (const t of ["checkout.session.completed", "checkout.session.expired", "payment_intent.succeeded", "charge.refunded"]) {
      assert.equal(routeConnectedEvent(ev(t, INVOICE_META)), "invoice", t);
    }
  });
  test("the store's event types, without that mark, are store events", () => {
    for (const t of STORE_EVENT_TYPES) assert.equal(routeConnectedEvent(ev(t, { purpose: "annual_update" })), "store", t);
    assert.equal(routeConnectedEvent(ev("checkout.session.completed")), "store");
    assert.equal(routeConnectedEvent(ev("charge.dispute.created")), "store");
  });
  test("every other event type is ignored", () => {
    for (const t of ["customer.created", "invoice.paid", "payout.paid", "balance.available"]) assert.equal(routeConnectedEvent(ev(t)), "ignore", t);
  });
  test("the store list is exactly the one the store's own webhook handles", () => {
    const fulfilment = readFileSync(new URL("../lib/commerce/fulfillment.ts", import.meta.url), "utf8");
    for (const t of STORE_EVENT_TYPES) assert.ok(fulfilment.includes(`"${t}"`), t);
    const handled = new Set([...fulfilment.matchAll(/case "((?:checkout\.session|payment_intent|charge)\.[a-z_.]+)"/g)].map((m) => m[1]));
    assert.deepEqual([...handled].sort(), [...STORE_EVENT_TYPES].sort());
  });
});

describe("dispatch", () => {
  function setup(over: Partial<DispatchDeps<RoutableEvent>> = {}) {
    const calls: string[] = [];
    const deps: DispatchDeps<RoutableEvent> = {
      tenantForAccount: async (a) => (a === "acct_1Mine" ? "tenant-1" : null),
      invoiceOrConnection: async (t, e) => { calls.push(`invoice:${t}:${e.type}`); return { status: "processed", invoiceId: "inv-1", paid: true }; },
      store: async (t, e) => { calls.push(`store:${t}:${e.type}`); return { status: "processed" }; },
      ...over,
    };
    return { deps, calls };
  }

  test("an invoice event reaches only the invoice handler, with its result", async () => {
    const { deps, calls } = setup();
    const r = await dispatchConnectEvent(deps, ev("checkout.session.completed", INVOICE_META));
    assert.deepEqual(calls, ["invoice:tenant-1:checkout.session.completed"]);
    assert.equal(r.route, "invoice");
    assert.equal(r.paid, true);
    assert.equal(r.invoiceId, "inv-1");
  });
  test("a store event reaches only the store handler", async () => {
    const { deps, calls } = setup();
    const r = await dispatchConnectEvent(deps, ev("checkout.session.completed", { purpose: "annual_update" }));
    assert.deepEqual(calls, ["store:tenant-1:checkout.session.completed"]);
    assert.equal(r.route, "store");
    assert.equal(r.status, "processed");
  });
  test("a connection event goes to the connection handler", async () => {
    const { deps, calls } = setup();
    assert.equal((await dispatchConnectEvent(deps, ev("account.updated"))).route, "connection");
    assert.deepEqual(calls, ["invoice:tenant-1:account.updated"]);
  });
  test("an account that is not connected to a workspace here, or no account at all, is acknowledged and left alone", async () => {
    const { deps, calls } = setup();
    assert.deepEqual(await dispatchConnectEvent(deps, ev("checkout.session.completed", null, "acct_1Other")), { status: "ignored", route: "unknown_account" });
    assert.deepEqual(await dispatchConnectEvent(deps, { ...ev("checkout.session.completed"), account: undefined }), { status: "ignored", route: "unknown_account" });
    assert.deepEqual(calls, []);
  });
  test("an unrelated event type for one of our accounts is ignored without calling a handler", async () => {
    const { deps, calls } = setup();
    assert.equal((await dispatchConnectEvent(deps, ev("payout.paid"))).status, "ignored");
    assert.deepEqual(calls, []);
  });
  test("a store that is not running on this account ignores the event rather than recording it", async () => {
    const { deps } = setup({ store: async () => null });
    assert.equal((await dispatchConnectEvent(deps, ev("payment_intent.succeeded"))).status, "ignored");
  });
  test("a handler failure propagates, so the webhook answers with an error and Stripe retries", async () => {
    const { deps } = setup({ store: async () => { throw new Error("db down"); } });
    await assert.rejects(dispatchConnectEvent(deps, ev("checkout.session.completed")), /db down/);
  });
});

describe("the webhook route", () => {
  const route = readFileSync(new URL("../app/api/stripe/connect-webhook/route.ts", import.meta.url), "utf8");
  test("verifies the signature and the mode before anything is routed", () => {
    assert.ok(route.indexOf("constructEventAsync") < route.indexOf("dispatchConnectEvent("));
    assert.ok(route.indexOf("mode mismatch") < route.indexOf("dispatchConnectEvent("));
  });
  test("store events run only for the storefront's workspace, and only while the store is on that very account", () => {
    assert.match(route, /tenantId !== currentTenantId\(\)\) return null/);
    assert.match(route, /st\.connectedAccount !== \(e as \{ account\?: string \}\)\.account\) return null/);
    assert.match(route, /handleStripeEvent\(stripeFulfillmentDeps\(st\.stripe\)/);
  });
  test("a failure answers non-2xx so Stripe retries", () => {
    assert.match(route, /new Response\("Processing failed", \{ status: 500 \}\)/);
  });
});
