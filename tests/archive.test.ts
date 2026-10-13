import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MemoryRepo, published } from "./memory-repo.ts";
import { createProduct } from "../lib/commerce/catalog.ts";
import { createInternalLicense } from "../lib/commerce/fulfillment.ts";
import type { NewProduct } from "../lib/commerce/types.ts";
import { archiveProblem, hardDeleteProblem, inView, moneyTaken, viewCounts, viewOf, type ArchiveEntity, type ArchiveFacts, type ArchiveLogEntry, type ArchiveLogRow, type ArchiveRow } from "../lib/archive.ts";
import { archiveRecord, hardDeleteRecord, restoreRecord, type ArchiveStore } from "../lib/archive-service.ts";

// Platform archive: Remove archives; restore brings records back; permanent delete is owner-only, for archived
// records, typed to confirm, and never for money. (Tenant isolation is tested in supabase/tests/archive_isolation.sql.)

const OWNER = "00000000-0000-4000-8000-00000000000a";
const ADMIN = "00000000-0000-4000-8000-00000000000b";

/** One tenant's archivable rows in memory, with the links the rules look at. */
class MemoryArchive implements ArchiveStore {
  rows = new Map<string, { entity: ArchiveEntity; row: ArchiveRow }>();
  facts_ = new Map<string, ArchiveFacts>();
  logs: ArchiveLogRow[] = [];
  removed: string[] = [];
  add(entity: ArchiveEntity, row: Partial<ArchiveRow>, facts: ArchiveFacts = {}) {
    const r = { id: randomUUID(), archived_at: null, archived_by: null, archive_reason: null, ...row } as ArchiveRow;
    this.rows.set(r.id, { entity, row: r });
    this.facts_.set(r.id, facts);
    return r.id;
  }
  async get(entity: ArchiveEntity, id: string) { const x = this.rows.get(id); return x && x.entity === entity ? structuredClone(x.row) : null; }
  async facts(_e: ArchiveEntity, row: ArchiveRow) { return this.facts_.get(row.id) ?? {}; }
  async update(_e: ArchiveEntity, id: string, patch: Record<string, unknown>) { Object.assign(this.rows.get(id)!.row, patch); }
  async remove(_e: ArchiveEntity, row: ArchiveRow) { this.rows.delete(row.id); this.removed.push(row.id); }
  async log(entry: ArchiveLogEntry) { this.logs.push({ ...entry, id: randomUUID(), tenant_id: "t", created_at: new Date().toISOString() }); }
  async history(entity: ArchiveEntity, id: string) { return this.logs.filter((l) => l.entity === entity && l.record_id === id); }
  async isOwner(userId: string) { return userId === OWNER; }
  row(id: string) { return this.rows.get(id)?.row; }
}

describe("lists", () => {
  test("current by default; archived only on the Archived tab", () => {
    const rows = [{ id: "a", archived_at: null }, { id: "b", archived_at: "2026-10-13T00:00:00Z" }, { id: "c" }];
    assert.deepEqual(inView(rows, viewOf(undefined)).map((r) => r.id), ["a", "c"]);
    assert.deepEqual(inView(rows, viewOf("archived")).map((r) => r.id), ["b"]);
    assert.equal(viewOf("anything-else"), "current");
    assert.deepEqual(viewCounts(rows), { current: 2, archived: 1 });
  });
});

describe("archiving", () => {
  test("Remove archives with who and why, changes nothing else, and is logged", async () => {
    const s = new MemoryArchive();
    const id = s.add("customer", { email: "test@example.com", full_name: "Test", status: "active" });
    await archiveRecord(s, "customer", id, ADMIN, "  test record ");
    const row = s.row(id)!;
    assert.ok(row.archived_at);
    assert.equal(row.archived_by, ADMIN);
    assert.equal(row.archive_reason, "test record");
    assert.equal(row.status, "active", "the customer's own status is untouched");
    assert.deepEqual(s.logs.map((l) => [l.action, l.actor_id, l.reason, l.label]), [["archived", ADMIN, "test record", "Test · test@example.com"]]);
    await assert.rejects(archiveRecord(s, "customer", id, ADMIN), /already archived/);
  });

  test("a license must be revoked first", async () => {
    const s = new MemoryArchive();
    const live = s.add("license", { key_prefix: "MTS-AAAAA", status: "active" });
    await assert.rejects(archiveRecord(s, "license", live, ADMIN), /Revoke this license first/);
    const revoked = s.add("license", { key_prefix: "MTS-BBBBB", status: "revoked" });
    await archiveRecord(s, "license", revoked, ADMIN);
    assert.ok(s.row(revoked)!.archived_at);
    assert.equal(archiveProblem("license", { id: "x", status: "expired" }), null, "an expired license can be archived too");
  });

  test("a customer with a live license or an open service order can't be archived yet", () => {
    const c = { id: "c" };
    assert.match(archiveProblem("customer", c, { licenses: [{ status: "active" }] })!, /a license that isn't revoked/);
    assert.match(archiveProblem("customer", c, { licenses: [{ status: "pending" }, { status: "suspended" }] })!, /2 licenses/);
    assert.match(archiveProblem("customer", c, { licenses: [{ status: "revoked" }], serviceOrders: [{ status: "in_progress" }] })!, /open service order/);
    assert.equal(archiveProblem("customer", c, { licenses: [{ status: "revoked" }], serviceOrders: [{ status: "delivered" }, { status: "canceled" }] }), null);
    assert.match(archiveProblem("order", { id: "o" }, { licenses: [{ status: "active" }] })!, /Revoke it first/);
    assert.match(archiveProblem("service_order", { id: "s", status: "new" })!, /Deliver or cancel/);
  });

  test("products, documents, workflows and forms also move to their archived status, and come back safely", async () => {
    const s = new MemoryArchive();
    const product = s.add("product", { name: "P", status: "published", stripe_price_id: "price_1" });
    const draftProduct = s.add("product", { name: "Q", status: "draft", stripe_price_id: null });
    const workflow = s.add("workflow", { name: "W", status: "active" });
    const form = s.add("form", { name: "F", status: "published", current_version_id: "v1" });
    const doc = s.add("document", { name: "D", status: "active" });
    for (const [e, id] of [["product", product], ["product", draftProduct], ["workflow", workflow], ["form", form], ["document", doc]] as const) {
      await archiveRecord(s, e, id, ADMIN);
      assert.equal(s.row(id)!.status, "archived", e);
      await restoreRecord(s, e, id, ADMIN);
      assert.equal(s.row(id)!.archived_at, null);
    }
    assert.equal(s.row(product)!.status, "unpublished", "a restored product is not on sale until published again");
    assert.equal(s.row(draftProduct)!.status, "draft");
    assert.equal(s.row(workflow)!.status, "paused", "a restored workflow doesn't run until turned on");
    assert.equal(s.row(form)!.status, "closed", "a restored form doesn't take submissions until reopened");
    assert.equal(s.row(doc)!.status, "active");
    assert.equal(s.logs.filter((l) => l.action === "restored").length, 5);
  });
});

describe("permanent delete", () => {
  async function archivedCustomer(s: MemoryArchive, facts: ArchiveFacts = {}) {
    const id = s.add("customer", { email: "Krystal.Test@example.com", full_name: "Krystal Test", status: "active" }, facts);
    await archiveRecord(s, "customer", id, ADMIN, "test record");
    return id;
  }

  test("owner only, archived only, and the email typed to confirm", async () => {
    const s = new MemoryArchive();
    const live = s.add("customer", { email: "live@example.com", full_name: "Live" });
    await assert.rejects(hardDeleteRecord(s, "customer", live, OWNER, "live@example.com"), /Archive this customer first/);
    const id = await archivedCustomer(s);
    await assert.rejects(hardDeleteRecord(s, "customer", id, ADMIN, "krystal.test@example.com"), /Only the account owner/);
    await assert.rejects(hardDeleteRecord(s, "customer", id, OWNER, "krystal@example.com"), /Type the customer's email exactly/);
    await hardDeleteRecord(s, "customer", id, OWNER, " krystal.test@example.com ");
    assert.deepEqual(s.removed, [id]);
    const last = s.logs.at(-1)!;
    assert.deepEqual([last.action, last.actor_id, last.label, last.reason], ["deleted", OWNER, "Krystal Test · Krystal.Test@example.com", "test record"], "the history still says what it was");
  });

  test("never an order that took money, or a customer with one", async () => {
    assert.equal(moneyTaken({ amount_cents: 0, payment_status: "paid" }), false, "a $0 order is not money");
    assert.equal(moneyTaken({ amount_cents: 7500, payment_status: "refunded" }), true, "refunded money was still taken");
    assert.equal(moneyTaken({ amount_cents: 7500, payment_status: "pending", paid_at: null }), false);
    const s = new MemoryArchive();
    const paid = s.add("order", { order_number: 1005, amount_cents: 7500, payment_status: "paid", paid_at: "2026-10-09T00:00:00Z" });
    await archiveRecord(s, "order", paid, ADMIN);
    await assert.rejects(hardDeleteRecord(s, "order", paid, OWNER, "1005"), /took real money/);
    const free = s.add("order", { order_number: 1009, amount_cents: 0, payment_status: "paid" });
    await archiveRecord(s, "order", free, ADMIN);
    await assert.rejects(hardDeleteRecord(s, "order", free, OWNER, "#1009"), /order number/);
    await hardDeleteRecord(s, "order", free, OWNER, "1009");
    const withMoney = await archivedCustomer(s, { orders: [{ amount_cents: 7500, payment_status: "paid" }] });
    await assert.rejects(hardDeleteRecord(s, "customer", withMoney, OWNER, "krystal.test@example.com"), /real money/);
    assert.deepEqual(s.removed, [free]);
  });

  test("each kind of record has its own confirmation", () => {
    const facts = { orderNumber: 1009 };
    const owner = (confirm: string) => ({ isOwner: true, confirm });
    const archived = { archived_at: "2026-10-13T00:00:00Z" };
    assert.equal(hardDeleteProblem("license", { id: "l", key_prefix: "MTS-PJG99", ...archived }, {}, owner("MTS-PJG99")), null);
    assert.equal(hardDeleteProblem("product", { id: "p", slug: "wisp-assisted-build", ...archived }, {}, owner("wisp-assisted-build")), null);
    assert.equal(hardDeleteProblem("service_order", { id: "s", ...archived }, facts, owner("1009")), null);
    assert.equal(hardDeleteProblem("workflow", { id: "w", name: "Welcome email", ...archived }, {}, owner("Welcome email")), null);
    assert.match(hardDeleteProblem("form", { id: "f", name: "ERO application", ...archived }, {}, owner("ero application"))!, /form's name/, "names are exact");
  });
});

describe("buying again", () => {
  const PRODUCT: NewProduct = {
    slug: "monarch-basic-tax-calculator", name: "Monarch Basic Tax Calculator", description: "Estimator.", product_type: "software", access_type: "license",
    installation_options: ["self_service"], price_cents: 7500, currency: "usd", stripe_product_id: "prod_TESTCALC123", stripe_price_id: null, status: "draft",
  };

  test("an archived customer who gets a new order with the same email is restored, and the history says so", async () => {
    const repo = new MemoryRepo();
    const product = await published(repo, await createProduct(repo, PRODUCT));
    const customer = await repo.createCustomer({ email: "returning@example.com", full_name: "Returning Client", stripe_customer_id: null });
    await repo.updateCustomer(customer.id, { archived_at: "2026-10-01T00:00:00Z", archived_by: ADMIN, archive_reason: "left" });
    await createInternalLicense(repo, { email: "Returning@Example.com", full_name: "Returning Client", phone: null, product_id: product.id, platform: "gohighlevel", website_url: null, domain: "example.com", reason: "Own account", admin_id: ADMIN, confirmed: true });
    const after = (await repo.getCustomer(customer.id))!;
    assert.equal(after.archived_at, null);
    assert.equal(after.archived_by, null);
    assert.equal((await repo.listCustomers()).length, 1, "the same customer, not a new one");
    assert.deepEqual(repo.archiveLog.map((l) => [l.action, l.record_id, l.actor_id]), [["auto_restored", customer.id, null]]);
    assert.match(repo.archiveLog[0].reason!, /internal license/);
  });
});
