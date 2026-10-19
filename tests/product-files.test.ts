import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { MemoryRepo, published, seedCheckout } from "./memory-repo.ts";
import { createProduct, setProductStatus } from "../lib/commerce/catalog.ts";
import { handleStripeEvent, issueLicenseKey, setLicenseStatus } from "../lib/commerce/fulfillment.ts";
import {
  cleanFileName, DOWNLOAD_URL_SECONDS, filesForLicense, finishUpload, issueDownload, MAX_FILE_BYTES, MAX_FILES_PER_PRODUCT, removeFile, startUpload, STORED_CONTENT_TYPE,
  type DownloadEvent, type FileStore, type ProductFile, type ProductFilesRepo,
} from "../lib/commerce/product-files.ts";
import type { NewProduct } from "../lib/commerce/types.ts";

// Product files (code bundles): stored and delivered, never executed; downloads only for active, paid licenses.

class MemoryFiles implements ProductFilesRepo {
  files: ProductFile[] = [];
  downloads: DownloadEvent[] = [];
  async insertFile(input: Pick<ProductFile, "product_id" | "storage_path" | "file_name" | "size_bytes" | "created_by">) {
    const f: ProductFile = { ...input, id: randomUUID(), status: "pending", created_at: new Date().toISOString(), ready_at: null, removed_at: null };
    this.files.push(f);
    return { ...f };
  }
  async getFile(id: string) { const f = this.files.find((x) => x.id === id); return f ? { ...f } : null; }
  async updateFile(id: string, patch: Partial<ProductFile>) { const f = this.files.find((x) => x.id === id)!; Object.assign(f, patch); return { ...f }; }
  async listFiles(productId: string) { return this.files.filter((f) => f.product_id === productId && f.status !== "removed").map((f) => ({ ...f })); }
  async addDownload(input: Omit<DownloadEvent, "id" | "created_at">) { const d = { ...input, id: randomUUID(), created_at: new Date().toISOString() }; this.downloads.push(d); return d; }
  async listDownloads(filter: { licenseId?: string; productId?: string }) { return this.downloads.filter((d) => (!filter.licenseId || d.license_id === filter.licenseId) && (!filter.productId || d.product_id === filter.productId)); }
}

class MemoryStore implements FileStore {
  objects = new Map<string, { size: number; contentType: string }>();
  signed: { path: string; fileName: string; seconds: number }[] = [];
  removed: string[] = [];
  async createUploadUrl(path: string) { return { url: `https://storage.test/upload/${path}` }; }
  async stat(path: string) { return this.objects.get(path) ?? null; }
  async signedDownloadUrl(path: string, fileName: string, seconds: number) { this.signed.push({ path, fileName, seconds }); return `https://storage.test/sign/${path}?download=${encodeURIComponent(fileName)}`; }
  async remove(paths: string[]) { for (const p of paths) { this.objects.delete(p); this.removed.push(p); } }
  /** Deleted by a person: queued for the 24-hour window (the file is purged later by the scheduler). */
  discarded: string[] = [];
  async discard(paths: string[]) { this.discarded.push(...paths); }
  /** What the browser's PUT to the signed upload URL would store. */
  land(path: string, size: number, contentType = STORED_CONTENT_TYPE) { this.objects.set(path, { size, contentType }); }
}

const PRODUCT: NewProduct = {
  slug: "lead-widget", name: "Lead Widget", description: "A lead capture widget.", product_type: "software", access_type: "license",
  installation_options: ["self_service"], price_cents: 4900, currency: "usd", stripe_product_id: "prod_WIDGET0001", stripe_price_id: "price_WIDGET0001", status: "draft",
};

async function shop() {
  const commerce = new MemoryRepo();
  const files = new MemoryFiles();
  const store = new MemoryStore();
  const product = await published(commerce, await createProduct(commerce, PRODUCT));
  const deps = { commerce, files, store };
  async function buyer(n: number) {
    await seedCheckout(commerce, `cs_buy${n}`, product.id, 4900);
    await handleStripeEvent({ repo: commerce, listCheckoutProductIds: async () => ["prod_WIDGET0001"] }, {
      id: `evt_${n}`, type: "checkout.session.completed",
      data: { object: { id: `cs_buy${n}`, payment_status: "paid", payment_intent: `pi_BUYER0000${n}`, amount_total: 4900, currency: "usd", customer: null, customer_details: { email: `b${n}@example.com`, name: "B" }, metadata: {} } },
    });
    const license = commerce.licenses.at(-1)!;
    const { key } = await issueLicenseKey(commerce, license.id, "admin");
    return { license, key };
  }
  async function uploaded(name = "widget-v1.zip", size = 1000, productId = product.id) {
    const { file } = await startUpload(deps, { productId, fileName: name, sizeBytes: size, adminId: "admin" });
    store.land(file.storage_path, size);
    return finishUpload(deps, file.id);
  }
  return { commerce, files, store, product, deps, buyer, uploaded };
}

describe("uploading code bundles", () => {
  test("only .zip, .html, .js and .css, with a safe base name", () => {
    assert.equal(cleanFileName("C:\\builds\\widget v1.ZIP"), "widget v1.ZIP");
    assert.equal(cleanFileName("../../etc/app.js"), "app.js");
    assert.equal(cleanFileName("<script>.html"), "_script_.html");
    for (const bad of ["setup.exe", "shell.php", "image.svg", "page.htm", "noextension", ".js"]) assert.throws(() => cleanFileName(bad), /can be uploaded|Give the file a name/, bad);
  });

  test("a requested upload is pending, private and stored as plain binary data", async () => {
    const { deps, product, files } = await shop();
    const ticket = await startUpload(deps, { productId: product.id, fileName: "widget.zip", sizeBytes: 2048, adminId: "admin" });
    assert.equal(ticket.contentType, "application/octet-stream");
    assert.match(ticket.file.storage_path, new RegExp(`^products/${product.id}/[0-9a-f-]{36}$`), "random object name, no user-chosen path");
    assert.equal(files.files[0].status, "pending");
  });

  test("size and count limits, and archived products, are enforced", async () => {
    const { deps, product, uploaded, commerce } = await shop();
    await assert.rejects(startUpload(deps, { productId: product.id, fileName: "big.zip", sizeBytes: MAX_FILE_BYTES + 1, adminId: "a" }), /at most 50 MB/);
    await assert.rejects(startUpload(deps, { productId: product.id, fileName: "empty.zip", sizeBytes: 0, adminId: "a" }), /empty/);
    for (let i = 0; i < 4; i++) await uploaded(`part-${i}.zip`, MAX_FILE_BYTES);
    await assert.rejects(startUpload(deps, { productId: product.id, fileName: "more.zip", sizeBytes: 1, adminId: "a" }), /total at most 200 MB/);
    const small = await createProduct(commerce, { ...PRODUCT, slug: "small", stripe_product_id: "prod_SMALL0001" });
    for (let i = 0; i < MAX_FILES_PER_PRODUCT; i++) await uploaded(`f${i}.js`, 10, small.id);
    await assert.rejects(startUpload(deps, { productId: small.id, fileName: "one-more.js", sizeBytes: 10, adminId: "a" }), /at most 20 files/);
    await setProductStatus(commerce, small.id, "archived");
    await assert.rejects(startUpload(deps, { productId: small.id, fileName: "late.js", sizeBytes: 10, adminId: "a" }), /Archived/);
  });

  test("an upload is accepted only if it landed with the declared size, as octet-stream", async () => {
    const { deps, product, store } = await shop();
    const a = await startUpload(deps, { productId: product.id, fileName: "a.html", sizeBytes: 500, adminId: "a" });
    await assert.rejects(finishUpload(deps, a.file.id), /did not arrive/);
    store.land(a.file.storage_path, 500, "text/html");
    await assert.rejects(finishUpload(deps, a.file.id), /not stored as plain binary data/);
    assert.ok(store.removed.includes(a.file.storage_path), "a renderable object is deleted");
    const b = await startUpload(deps, { productId: product.id, fileName: "b.js", sizeBytes: 500, adminId: "a" });
    store.land(b.file.storage_path, 900);
    await assert.rejects(finishUpload(deps, b.file.id), /size does not match/);
    const c = await startUpload(deps, { productId: product.id, fileName: "c.css", sizeBytes: 500, adminId: "a" });
    store.land(c.file.storage_path, 500);
    assert.equal((await finishUpload(deps, c.file.id)).status, "ready");
  });
});

describe("delivering files to license holders", () => {
  test("an active, paid license lists and downloads its product's files; each download is logged", async () => {
    const { deps, uploaded, buyer, files, store } = await shop();
    const file = await uploaded("widget-v1.zip");
    const { license, key } = await buyer(1);
    const listed = await filesForLicense(deps, key.toLowerCase());
    assert.deepEqual(listed.files.map((f) => f.file_name), ["widget-v1.zip"]);
    const url = await issueDownload(deps, { rawKey: key, fileId: file.id, clientHash: "h1" });
    assert.match(url, /download=widget-v1\.zip/);
    assert.deepEqual(store.signed[0], { path: file.storage_path, fileName: "widget-v1.zip", seconds: DOWNLOAD_URL_SECONDS });
    assert.equal(DOWNLOAD_URL_SECONDS, 60);
    assert.equal(files.downloads.length, 1);
    assert.equal(files.downloads[0].license_id, license.id);
    assert.equal(files.downloads[0].client_hash, "h1");
  });

  test("unlicensed visitors, wrong keys, inactive licenses and unpaid orders get nothing", async () => {
    const { deps, uploaded, buyer, files, store, commerce } = await shop();
    const file = await uploaded();
    await assert.rejects(filesForLicense(deps, "not a key"), /Enter your license key/);
    await assert.rejects(issueDownload(deps, { rawKey: "MTS-AAAAA-BBBBB-CCCCC-DDDDD", fileId: file.id, clientHash: null }), /not found/);
    const { license, key } = await buyer(1);
    await setLicenseStatus(commerce, license.id, "suspended", "test", "admin");
    await assert.rejects(issueDownload(deps, { rawKey: key, fileId: file.id, clientHash: null }), /suspended/);
    await setLicenseStatus(commerce, license.id, "active", null, "admin");
    await commerce.updateOrder(commerce.orders.at(-1)!.id, { payment_status: "refunded" });
    await assert.rejects(issueDownload(deps, { rawKey: key, fileId: file.id, clientHash: null }), /not paid/);
    assert.equal(files.downloads.length, 0);
    assert.equal(store.signed.length, 0, "no URL was ever signed");
  });

  test("a license cannot download another product's files, pending files or removed files", async () => {
    const { deps, uploaded, buyer, commerce, store } = await shop();
    const other = await published(commerce, await createProduct(commerce, { ...PRODUCT, slug: "other", stripe_product_id: "prod_OTHER0001" }));
    const foreign = await uploaded("other.zip", 10, other.id);
    const mine = await uploaded("mine.zip");
    const pending = (await startUpload(deps, { productId: (await commerce.listProducts())[0].id, fileName: "pending.zip", sizeBytes: 5, adminId: "a" })).file;
    const { key } = await buyer(1);
    await assert.rejects(issueDownload(deps, { rawKey: key, fileId: foreign.id, clientHash: null }), /not available for this license/);
    await assert.rejects(issueDownload(deps, { rawKey: key, fileId: pending.id, clientHash: null }), /not available/);
    await removeFile(deps, mine.id);
    assert.ok(store.discarded.includes(mine.storage_path), "the file is queued for the 24-hour window");
    await assert.rejects(issueDownload(deps, { rawKey: key, fileId: mine.id, clientHash: null }), /not available/);
    assert.deepEqual((await filesForLicense(deps, key)).files, []);
  });
});

describe("security boundary: stored and delivered, never executed", () => {
  const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

  test("the bucket is private and accepts only application/octet-stream", () => {
    const sql = read("supabase/migrations/20261013100000_product_files.sql");
    assert.match(sql, /values \('product-files', 'product-files', false, 52428800, array\['application\/octet-stream'\]\)/);
    assert.match(sql, /set public = false/);
  });

  test("product files are only ever handed out as signed downloads, never as public URLs or app routes", () => {
    const store = read("lib/commerce/supabase-files.ts");
    assert.doesNotMatch(store, /getPublicUrl/);
    assert.match(store, /createSignedUrl\(path, seconds, \{ download: fileName \}\)/);
    // The only buyer entry point redirects to the signed URL; no app route streams file contents.
    assert.match(read("app/downloads/actions.ts"), /redirect\(url\)/);
    assert.doesNotMatch(read("app/downloads/actions.ts"), /new Response|arrayBuffer|\.download\(/);
  });
});
