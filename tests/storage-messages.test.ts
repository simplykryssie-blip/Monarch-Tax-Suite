import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isMediaPath, legacyPathFromUrl, mediaPathFromUrl, mediaType, mediaUrl, tenantBucket } from "../lib/storage/paths.ts";
import { discardObjects, removeObjects, scheduleRemoval, sweepStorageCleanup } from "../lib/storage/objects.ts";
import { DELETE_WINDOW_HOURS, deletedNotice } from "../lib/storage/window.ts";
import { staleThemeImages } from "../lib/forms/theme-images.ts";
import { deleteLibraryImage, emailMarkdown, uploadLibraryImage, type ImagesRepo, type NewTenantImage, type TenantImage } from "../lib/images/service.ts";
import type { ImageStore, ImageType } from "../lib/commerce/types.ts";
import { deleteClientDoc, sweepPendingClientDocs } from "../lib/workspace/docs.ts";
import { plainEmailHtml, sendClientMessage, type SendDeps } from "../lib/workspace/send.ts";
import { platformLogin, platformSendProblems, platformTwilio, segmentCount, toE164, TwilioAccounts, TwilioSmsSender } from "../lib/automation/twilio.ts";
import { CrmSecrets } from "../lib/crm/crypto.ts";
import { MONARCH_TENANT_ID } from "../lib/tenants.ts";
import { resolveSmsRoute, secretAad } from "../lib/sms/route.ts";
import { buyNumber, findNumbers, setupSmsAccount, smsSetupStep } from "../lib/sms/service.ts";
import type { SmsAccount, SmsAccountsRepo } from "../lib/sms/types.ts";
import type { EmailMessage, SendResult } from "../lib/automation/email.ts";
import { MemoryWorkspace } from "./workspace-memory.ts";
import { MemoryDocumentStore } from "./documents-memory.ts";

// CRM Round 2 corrections: per-tenant private image storage, files deleted with their records, and sending email and
// texts from a client's profile. Fake people and example.com addresses only.

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const ID = "11111111-2222-4333-8444-555555555555";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 40, 0, 0, 0, 30, 8, 6, 0, 0, 0]);

describe("each tenant has its own private image bucket", () => {
  test("bucket names come from the tenant id; a bad id is refused", () => {
    assert.equal(tenantBucket(A), `tenant-${A}`);
    assert.notEqual(tenantBucket(A), tenantBucket(B));
    assert.throws(() => tenantBucket("../other"), /tenant id/);
  });

  test("only image files under images/ are media; documents and path tricks are not", () => {
    assert.ok(isMediaPath(`images/library/${ID}.png`));
    assert.ok(isMediaPath(`images/products/${ID}/${ID}.webp`));
    for (const bad of [`${A}/clients/${ID}/${ID}.pdf`, `images/../${A}/x.png`, "images/x.pdf", "images/X.PNG", `products/${ID}/${ID}.png`, "images//x.png"]) assert.equal(isMediaPath(bad), false, bad);
    assert.equal(mediaType("images/a.jpg"), "image/jpeg");
  });

  test("a /media address belongs to one tenant: another tenant's address is not recognised as its own", () => {
    const url = mediaUrl("https://app.example.com", A, `images/library/${ID}.png`);
    assert.equal(url, `https://app.example.com/media/${A}/images/library/${ID}.png`);
    assert.equal(mediaPathFromUrl(url, A), `images/library/${ID}.png`);
    assert.equal(mediaPathFromUrl(url, B), null);
    assert.equal(mediaUrl("", A, `images/library/${ID}.png`), `/media/${A}/images/library/${ID}.png`);
    assert.equal(legacyPathFromUrl(`https://x.supabase.co/storage/v1/object/public/product-images/forms/${ID}/${ID}.png`), `forms/${ID}/${ID}.png`);
    assert.equal(legacyPathFromUrl("https://elsewhere.example.com/logo.png"), null);
  });

  test("the migration makes a private bucket for every tenant, and one for each new tenant; none are public", () => {
    const sql = readFileSync(new URL("../supabase/migrations/20261031090000_tenant_storage_and_sending.sql", import.meta.url), "utf8");
    assert.match(sql, /insert into storage\.buckets[\s\S]*values \(b, b, false,/);
    assert.match(sql, /for t in select id from public\.tenants loop\s+perform public\.ensure_tenant_bucket\(t\)/);
    assert.match(sql, /after insert on public\.tenants for each row execute function public\.tenants_make_bucket\(\)/);
    assert.doesNotMatch(sql, /create policy[^;]*storage\.objects/i, "no storage policies: only the server reads or writes");
  });

  test("the media route reads only from the requested tenant's bucket and only image paths", () => {
    const src = readFileSync(new URL("../app/media/[tenant]/[...path]/route.ts", import.meta.url), "utf8");
    assert.match(src, /storage\.from\(tenantBucket\(tenant\)\)/);
    assert.match(src, /!isMediaPath\(path\)/);
    assert.doesNotMatch(src, /platformClient/);
  });
});

// A stand-in for the Supabase client: storage.remove and the storage_cleanup table.
function fakeDb(opts: { failRemove?: boolean; failQueue?: boolean } = {}) {
  const removed: { bucket: string; paths: string[] }[] = [];
  let queue: { id: string; bucket: string; path: string; purge_after: string; attempts: number; last_error?: string | null }[] = [];
  const db = {
    storage: { from: (bucket: string) => ({ remove: async (paths: string[]) => {
      if (opts.failRemove) return { data: null, error: { message: "storage unavailable" } };
      removed.push({ bucket, paths });
      return { data: [], error: null };
    } }) },
    from: (table: string) => {
      assert.equal(table, "storage_cleanup");
      return {
        upsert: async (rows: { bucket: string; path: string; purge_after: string; last_error: string | null }[]) => {
          if (opts.failQueue) return { error: { message: "database unavailable" } };
          for (const r of rows) if (!queue.some((q) => q.bucket === r.bucket && q.path === r.path)) queue.push({ id: `q${queue.length}`, attempts: 0, ...r });
          return { error: null };
        },
        select: () => ({ lte: (_c: string, at: string) => ({ order: () => ({ limit: async () => ({ data: queue.filter((q) => q.purge_after <= at), error: null }) }) }) }),
        delete: () => ({ in: async (_c: string, ids: string[]) => { queue = queue.filter((q) => !ids.includes(q.id)); return { error: null }; } }),
        update: (patch: { attempts: number }) => ({ eq: async (_c: string, id: string) => { Object.assign(queue.find((q) => q.id === id)!, patch); return { error: null }; } }),
      };
    },
  };
  return { db: db as never, removed, queue: () => queue, heal: () => { opts.failRemove = false; } };
}

describe("the 24-hour delete window", () => {
  test("a file a person deleted stays for 24 hours, then the scheduler purges it", async () => {
    const f = fakeDb();
    const at = new Date("2026-10-16T12:00:00Z");
    await scheduleRemoval(f.db, `tenant-${A}`, [`images/library/${ID}.png`], at);
    assert.equal(f.queue()[0].purge_after, "2026-10-17T12:00:00.000Z");
    assert.deepEqual(await sweepStorageCleanup(f.db, 100, new Date("2026-10-17T11:59:00Z")), { removed: 0, failed: 0 }, "not yet");
    assert.deepEqual(f.removed, []);
    assert.deepEqual(await sweepStorageCleanup(f.db, 100, new Date("2026-10-17T12:00:00Z")), { removed: 1, failed: 0 });
    assert.deepEqual(f.removed, [{ bucket: `tenant-${A}`, paths: [`images/library/${ID}.png`] }]);
    assert.deepEqual(f.queue(), []);
  });

  test("if the file can't be queued, it is deleted at once rather than left behind", async () => {
    const f = fakeDb({ failQueue: true });
    await discardObjects(f.db, "tenant-documents", ["a.pdf"]);
    assert.deepEqual(f.removed, [{ bucket: "tenant-documents", paths: ["a.pdf"] }]);
  });

  test("the notice says when the file goes and that it can't be recovered after", () => {
    assert.equal(DELETE_WINDOW_HOURS, 24);
    assert.match(deletedNotice("Document"), /^Document deleted\. .*permanently deleted in 24 hours and can't be recovered after that\.$/);
  });
});

describe("files are deleted with their records", () => {
  test("a removal that fails is queued, and the scheduler deletes the file later", async () => {
    const f = fakeDb({ failRemove: true });
    await assert.rejects(removeObjects(f.db, "tenant-documents", [`${A}/clients/x.pdf`]), /File removal failed/);
    assert.deepEqual(f.queue().map((q) => q.path), [`${A}/clients/x.pdf`]);
    assert.deepEqual(await sweepStorageCleanup(f.db), { removed: 0, failed: 1 });
    assert.equal(f.queue()[0].attempts, 1);
    f.heal();
    assert.deepEqual(await sweepStorageCleanup(f.db), { removed: 1, failed: 0 });
    assert.deepEqual(f.queue(), []);
    assert.deepEqual(f.removed, [{ bucket: "tenant-documents", paths: [`${A}/clients/x.pdf`] }]);
  });

  test("a removal that works queues nothing", async () => {
    const f = fakeDb();
    await removeObjects(f.db, "b", ["a", "a", ""]);
    assert.deepEqual(f.removed, [{ bucket: "b", paths: ["a"] }]);
    assert.deepEqual(f.queue(), []);
  });

  test("deleting a client document deletes its file; uploads never finished are swept after a day", async () => {
    const repo = new MemoryWorkspace();
    const store = new MemoryDocumentStore();
    const client = await repo.insertClient({ full_name: "Test Client", email: null, phone: null, ssn_last4: null, address: null, created_by: null });
    const path = `${A}/clients/${client.id}/${ID}.pdf`;
    store.put(path, new Uint8Array([1]));
    const doc = await repo.insertDoc({ client_id: client.id, return_id: null, title: "W-2", file_path: path, file_type: "pdf", size_bytes: 1, status: "stored", uploaded_by: null });
    await deleteClientDoc({ tenantId: A, repo, store }, doc.id);
    assert.deepEqual(store.discarded, [path], "kept for the 24-hour window, then purged by the scheduler");
    assert.equal(await repo.getDoc(doc.id), null);

    const pendingPath = `${A}/clients/${client.id}/${B}.pdf`;
    store.put(pendingPath, new Uint8Array([1]));
    const pending = await repo.insertDoc({ client_id: client.id, return_id: null, title: "Half done", file_path: pendingPath, file_type: "pdf", size_bytes: 1, status: "pending", uploaded_by: null });
    repo.docs.find((d) => d.id === pending.id)!.created_at = "2026-10-01T00:00:00.000Z";
    assert.equal(await sweepPendingClientDocs({ tenantId: A, repo, store }, new Date("2026-10-03T00:00:00Z")), 1);
    assert.equal(store.objects.has(pendingPath), false);
    assert.equal(await repo.getDoc(pending.id), null);
  });

  test("a form's replaced or removed logo is deleted, unless another form still shows it; other folders are never touched", () => {
    const own = (form: string) => mediaUrl("https://app.example.com", A, `images/forms/${form}/${ID}.png`);
    const before = { logo_url: own(ID), header_image_url: `https://x.supabase.co/storage/v1/object/public/product-images/forms/${ID}/${B}.png` };
    assert.deepEqual(staleThemeImages(A, ID, before, { logo_url: null, header_image_url: null }, []), [`images/forms/${ID}/${ID}.png`, `forms/${ID}/${B}.png`]);
    assert.deepEqual(staleThemeImages(A, ID, before, before, []), [], "unchanged: nothing deleted");
    assert.deepEqual(staleThemeImages(A, ID, before, null, [before]), [], "a duplicated form still shows them");
    const someoneElses = { logo_url: own(B), header_image_url: mediaUrl("https://app.example.com", B, `images/forms/${ID}/${ID}.png`) };
    assert.deepEqual(staleThemeImages(A, ID, someoneElses, null, []), [], "another form's folder, or another tenant's file, is never deleted");
  });
});

class MemoryImages implements ImagesRepo {
  rows: TenantImage[] = [];
  failInsert = false;
  async list() { return this.rows; }
  async get(id: string) { return this.rows.find((r) => r.id === id) ?? null; }
  async insert(input: NewTenantImage) {
    if (this.failInsert) throw new Error("db down");
    const r = { ...input, id: ID, tenant_id: A, created_at: "now" };
    this.rows.push(r);
    return r;
  }
  async remove(id: string) { this.rows = this.rows.filter((r) => r.id !== id); }
}
class MemoryImageStore implements ImageStore {
  objects = new Map<string, ImageType>();
  async put(path: string, _bytes: Uint8Array, type: ImageType) { this.objects.set(path, type); }
  async remove(paths: string[]) { for (const p of paths) this.objects.delete(p); }
  discarded: string[] = [];
  async discard(paths: string[]) { this.discarded.push(...paths); }
  async copy(from: string, to: string) { this.objects.set(to, this.objects.get(from)!); }
  publicUrl(path: string) { return mediaUrl("https://app.example.com", A, path); }
}

describe("email images", () => {
  test("an upload is checked, stored in the account's images/library folder and recorded; deleting removes the file", async () => {
    const repo = new MemoryImages();
    const store = new MemoryImageStore();
    await assert.rejects(uploadLibraryImage(repo, store, { bytes: new TextEncoder().encode("<svg onload=x>"), declaredType: "image/svg+xml", fileName: "x.svg" }, "u"), /JPG, PNG, or WebP/);
    const img = await uploadLibraryImage(repo, store, { bytes: PNG, declaredType: "image/png", fileName: "../../Logo Final.png", altText: " Our  logo " }, "u");
    assert.match(img.storage_path, /^images\/library\/[0-9a-f-]{36}\.png$/);
    assert.equal(img.file_name, "Logo Final.png");
    assert.equal(img.alt_text, "Our logo");
    assert.deepEqual([img.width, img.height], [40, 30]);
    assert.ok(store.objects.has(img.storage_path));
    assert.equal(emailMarkdown(store.publicUrl(img.storage_path), img.alt_text), `![Our logo](https://app.example.com/media/${A}/${img.storage_path})`);
    await deleteLibraryImage(repo, store, img.id);
    assert.deepEqual(store.discarded, [img.storage_path]);
    assert.equal(repo.rows.length, 0);
  });

  test("if the record can't be saved, the uploaded file is removed again", async () => {
    const repo = new MemoryImages();
    repo.failInsert = true;
    const store = new MemoryImageStore();
    await assert.rejects(uploadLibraryImage(repo, store, { bytes: PNG, declaredType: "image/png", fileName: "a.png" }, "u"), /db down/);
    assert.equal(store.objects.size, 0);
  });
});

const SID = `AC${"a".repeat(32)}`;
const SUB = `AC${"b".repeat(32)}`;
const KEY = `SK${"c".repeat(32)}`;

describe("texting through Twilio", () => {
  test("phone numbers become +1… form; unusable ones are refused", () => {
    assert.equal(toE164("(337) 555-0100"), "+13375550100");
    assert.equal(toE164("1-337-555-0100"), "+13375550100");
    assert.equal(toE164("+44 20 7946 0958"), "+442079460958");
    assert.equal(toE164("555-0100"), null);
    assert.equal(toE164(""), null);
  });

  test("segments: 160 plain characters is one; longer splits at 153; other alphabets at 70/67", () => {
    assert.equal(segmentCount("x".repeat(160)), 1);
    assert.equal(segmentCount("x".repeat(161)), 2);
    assert.equal(segmentCount("x".repeat(306)), 2);
    assert.equal(segmentCount("x".repeat(307)), 3);
    assert.equal(segmentCount("✓".repeat(70)), 1);
    assert.equal(segmentCount("✓".repeat(71)), 2);
  });

  test("the owner's settings: missing ones are named, never their values; an API key is preferred to the auth token", () => {
    assert.equal(platformSendProblems(platformTwilio({})).length, 3);
    const env = { TWILIO_ACCOUNT_SID: SID, TWILIO_AUTH_TOKEN: "secret-token", TWILIO_FROM_NUMBER: "+13375550199" };
    assert.deepEqual(platformSendProblems(platformTwilio(env)), []);
    assert.deepEqual(platformLogin(platformTwilio(env)), { username: SID, password: "secret-token" });
    assert.deepEqual(platformLogin(platformTwilio({ ...env, TWILIO_API_KEY: KEY, TWILIO_API_SECRET: "key-secret" })), { username: KEY, password: "key-secret" });
    assert.ok(platformSendProblems(platformTwilio({ TWILIO_ACCOUNT_SID: SID, TWILIO_API_KEY: KEY })).some((p: string) => /TWILIO_API_SECRET/.test(p)));
    assert.ok(platformSendProblems(platformTwilio({ ...env, TWILIO_ACCOUNT_SID: "nope" })).every((p: string) => !p.includes("secret-token")));
  });

  test("the request goes to the sending account's Messages endpoint with its own login; the secret never appears in an error", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const ok = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify({ sid: "SM123" }), { status: 201 }); }) as unknown as typeof fetch;
    const route = { accountSid: SUB, username: KEY, password: "key-secret", from: "+13375550199", messagingServiceSid: null };
    assert.deepEqual(await new TwilioSmsSender(route, ok).send("+13375550100", "Hi"), { ok: true, id: "SM123" });
    assert.equal(calls[0].url, `https://api.twilio.com/2010-04-01/Accounts/${SUB}/Messages.json`);
    assert.equal(String(calls[0].init.body), "To=%2B13375550100&Body=Hi&From=%2B13375550199");
    assert.equal((calls[0].init.headers as Record<string, string>).Authorization, `Basic ${Buffer.from(`${KEY}:key-secret`).toString("base64")}`);
    const denied = (async () => new Response(JSON.stringify({ message: "Authenticate" }), { status: 401 })) as unknown as typeof fetch;
    const r = await new TwilioSmsSender(route, denied).send("+13375550100", "Hi");
    assert.equal(!r.ok && r.kind, "config");
    assert.ok(!JSON.stringify(r).includes("key-secret"));
  });
});

const account = (over: Partial<SmsAccount> = {}): SmsAccount => ({
  id: "acc", tenant_id: B, subaccount_sid: SUB, api_key_sid: KEY, api_key_secret_encrypted: null, from_number: "+13375550111", phone_number_sid: null,
  messaging_service_sid: null, registration_status: "approved", status: "active", created_by: null, created_at: "2026-10-16T00:00:00Z", updated_at: "2026-10-16T00:00:00Z", ...over,
});
const secrets = new CrmSecrets(Buffer.alloc(32, 7));
const OWNER_ENV = platformTwilio({ TWILIO_ACCOUNT_SID: SID, TWILIO_AUTH_TOKEN: "owner-token", TWILIO_FROM_NUMBER: "+13375550199" });

describe("each office texts from its own Twilio account", () => {
  test("tenant #1 sends from the owner's account in Vercel and pays Twilio directly", () => {
    const r = resolveSmsRoute(MONARCH_TENANT_ID, null, OWNER_ENV, secrets);
    assert.ok(r.ok);
    assert.equal(r.billing, "direct");
    assert.deepEqual(r.ok && r.route, { accountSid: SID, username: SID, password: "owner-token", from: "+13375550199", messagingServiceSid: null });
  });

  test("another office sends only from its own subaccount, with its own key, on credits; never from the owner's number", () => {
    assert.match((resolveSmsRoute(B, null, OWNER_ENV, secrets) as { problem: string }).problem, /isn't set up/);
    const enc = secrets.encrypt("office-key-secret", secretAad(B));
    const r = resolveSmsRoute(B, account({ api_key_secret_encrypted: enc }), OWNER_ENV, secrets);
    assert.ok(r.ok);
    assert.equal(r.billing, "credits");
    assert.deepEqual(r.ok && r.route, { accountSid: SUB, username: KEY, password: "office-key-secret", from: "+13375550111", messagingServiceSid: null });
  });

  test("an office's key can't be used by another office (the secret is bound to its tenant)", () => {
    const enc = secrets.encrypt("office-key-secret", secretAad(B));
    const r = resolveSmsRoute(A, account({ tenant_id: A, api_key_secret_encrypted: enc }), OWNER_ENV, secrets);
    assert.equal(r.ok, false);
    assert.match((r as { problem: string }).problem, /can't be read/);
  });

  test("no texts until there's a number, the registration is approved and the account is active", () => {
    const enc = secrets.encrypt("s", secretAad(B));
    const problem = (a: SmsAccount) => (resolveSmsRoute(B, a, OWNER_ENV, secrets) as { problem: string }).problem;
    assert.match(problem(account({ api_key_secret_encrypted: enc, from_number: null })), /no texting number/);
    assert.match(problem(account({ api_key_secret_encrypted: enc, registration_status: "submitted" })), /A2P 10DLC/);
    assert.match(problem(account({ api_key_secret_encrypted: enc, status: "suspended" })), /paused/);
    assert.match(problem(account({ api_key_secret_encrypted: null })), /didn't finish/);
  });
});

class MemorySmsAccounts implements SmsAccountsRepo {
  row: SmsAccount | null = null;
  entries: { delta: number; kind: string; reference: string | null }[] = [];
  async get() { return this.row; }
  async insert(input: Partial<SmsAccount>) { this.row = account({ subaccount_sid: null, api_key_sid: null, from_number: null, registration_status: "not_started", status: "setting_up", ...input }); return this.row; }
  async update(_id: string, patch: Partial<SmsAccount>) { this.row = { ...this.row!, ...patch }; return this.row; }
  async balance() { return this.entries.reduce((n, e) => n + e.delta, 0); }
  async ledger() { return []; }
  async spend(n: number, reference: string) { if ((await this.balance()) < n) return false; this.entries.push({ delta: -n, kind: "send", reference }); return true; }
  async credit(e: { delta: number; kind: string; reference: string | null }) { this.entries.push(e); }
}

function fakeTwilio(failKey = false) {
  const calls: string[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const path = url.replace("https://api.twilio.com/2010-04-01", "");
    calls.push(`${init.method} ${path}`);
    if (path === "/Accounts.json") return new Response(JSON.stringify({ sid: SUB }), { status: 201 });
    if (path.endsWith("/Keys.json")) return failKey ? new Response(JSON.stringify({ message: "down" }), { status: 500 }) : new Response(JSON.stringify({ sid: KEY, secret: "new-key-secret" }), { status: 201 });
    if (path.includes("/AvailablePhoneNumbers/")) return new Response(JSON.stringify({ available_phone_numbers: [{ phone_number: "+13375550123", friendly_name: "(337) 555-0123", locality: "Lafayette", region: "LA" }] }));
    if (path.endsWith("/IncomingPhoneNumbers.json")) return new Response(JSON.stringify({ sid: `PN${"d".repeat(32)}`, phone_number: "+13375550123" }), { status: 201 });
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
  return { twilio: new TwilioAccounts({ username: SID, password: "owner-token" }, f), calls };
}

describe("setting up an office's texting account", () => {
  test("makes a subaccount and a key inside it (secret encrypted), then buys a number into it once credits are there", async () => {
    const repo = new MemorySmsAccounts();
    const { twilio, calls } = fakeTwilio();
    const d = { tenantId: B, repo, twilio, secrets };
    const acc = await setupSmsAccount(d, "Test Tax Office", "u");
    assert.equal(acc.subaccount_sid, SUB);
    assert.equal(acc.api_key_sid, KEY);
    assert.notEqual(acc.api_key_secret_encrypted, "new-key-secret");
    assert.equal(secrets.decrypt(acc.api_key_secret_encrypted!, secretAad(B)), "new-key-secret");
    assert.deepEqual(calls, ["POST /Accounts.json", `POST /Accounts/${SUB}/Keys.json`]);
    assert.equal(smsSetupStep(acc), "number");

    await setupSmsAccount(d, "Test Tax Office", "u");
    assert.equal(calls.length, 2, "repeating setup makes nothing new");

    await assert.rejects(findNumbers(d, "12"), /area code/);
    const found = await findNumbers(d, "337");
    assert.equal(found[0].phoneNumber, "+13375550123");
    assert.ok(calls.at(-1)!.startsWith(`GET /Accounts/${SUB}/AvailablePhoneNumbers/US/Local.json?AreaCode=337`));
    await assert.rejects(buyNumber(d, "+13375550123"), /Buy text credits/);
    repo.entries.push({ delta: 100, kind: "grant", reference: null });
    const bought = await buyNumber(d, "+13375550123");
    assert.equal(calls.at(-1), `POST /Accounts/${SUB}/IncomingPhoneNumbers.json`);
    assert.deepEqual([bought.from_number, bought.status], ["+13375550123", "active"]);
    assert.equal(smsSetupStep(bought), "registration", "still waiting for carrier approval");
    await assert.rejects(buyNumber(d, "+13375550124"), /already texts from/);
  });

  test("a setup that stopped half-way carries on with the same subaccount", async () => {
    const repo = new MemorySmsAccounts();
    const first = fakeTwilio(true);
    await assert.rejects(setupSmsAccount({ tenantId: B, repo, twilio: first.twilio, secrets }, "Office", "u"), /Twilio refused/);
    assert.equal(repo.row?.subaccount_sid, SUB, "the subaccount was recorded before the key failed");
    const second = fakeTwilio();
    await setupSmsAccount({ tenantId: B, repo, twilio: second.twilio, secrets }, "Office", "u");
    assert.deepEqual(second.calls, [`POST /Accounts/${SUB}/Keys.json`], "no second subaccount");
  });

  test("tenant #1 isn't set up this way: it uses the owner's account", async () => {
    await assert.rejects(setupSmsAccount({ tenantId: MONARCH_TENANT_ID, repo: new MemorySmsAccounts(), twilio: fakeTwilio().twilio, secrets }, "Monarch", "u"), /owner's own Twilio account/);
  });

  test("the migration keeps both tables per tenant and spends credits only when the balance covers them", () => {
    const sql = readFileSync(new URL("../supabase/migrations/20261101090000_tenant_sms.sql", import.meta.url), "utf8");
    assert.match(sql, /create unique index if not exists tenant_sms_accounts_one_per_tenant on public\.tenant_sms_accounts \(tenant_id\)/);
    assert.match(sql, /security invoker/);
    assert.match(sql, /pg_advisory_xact_lock/);
    assert.match(sql, /if have < p_segments then\s+return false;/);
  });
});

describe("sending from a client's profile", () => {
  async function setup(over: Partial<SendDeps> = {}, results: { email?: SendResult; sms?: SendResult } = {}) {
    const repo = new MemoryWorkspace();
    const client = await repo.insertClient({ full_name: "Test Client", email: "test.client@example.com", phone: "(337) 555-0100", ssn_last4: null, address: null, created_by: null });
    const emails: EmailMessage[] = [];
    const texts: { to: string; body: string }[] = [];
    const deps: SendDeps = {
      repo,
      email: { send: async (m) => { emails.push(m); return results.email ?? { ok: true, id: "em_1" }; } },
      sms: { sender: { send: async (to: string, body: string) => { texts.push({ to, body }); return results.sms ?? { ok: true, id: "SM1" }; } }, problem: null, credits: null },
      sender: async () => ({ from: "Office <office@example.com>", replyTo: "help@example.com", label: "Office" }),
      env: "production",
      testRecipients: [],
      ...over,
    };
    return { repo, client, emails, texts, deps };
  }

  test("an email goes from the account's sender to the client's address, as safe HTML, and is recorded as sent", async () => {
    const { deps, client, emails, repo } = await setup();
    const m = await sendClientMessage(deps, client.id, { channel: "email", subject: "Your return", body: "Hi <b>Test</b>,\n\nAll done." }, "staff");
    assert.equal(emails[0].to, "test.client@example.com");
    assert.equal(emails[0].from, "Office <office@example.com>");
    assert.equal(emails[0].replyTo, "help@example.com");
    assert.match(emails[0].html, /Hi &lt;b&gt;Test&lt;\/b&gt;,<\/p><p[^>]*>All done\./);
    assert.deepEqual([m.status, m.channel, m.sent_to, m.provider_id, m.direction], ["sent", "email", "test.client@example.com", "em_1", "out"]);
    assert.equal((await repo.listMessages(client.id)).length, 1);
  });

  test("a text goes to the client's mobile in +1 form and is recorded", async () => {
    const { deps, client, texts } = await setup();
    const m = await sendClientMessage(deps, client.id, { channel: "sms", body: "Your return was accepted." }, "staff");
    assert.deepEqual(texts, [{ to: "+13375550100", body: "Your return was accepted." }]);
    assert.equal(m.status, "sent");
    await assert.rejects(sendClientMessage(deps, client.id, { channel: "sms", body: "x".repeat(481) }, "staff"), /up to 480/);
  });

  test("a provider failure is recorded as failed and reported; missing settings are reported without a history entry", async () => {
    const failed = await setup({}, { email: { ok: false, kind: "permanent", message: "The email provider rejected the message (422)." } });
    await assert.rejects(sendClientMessage(failed.deps, failed.client.id, { channel: "email", subject: "S", body: "B" }, "staff"), /Not sent\. The email provider rejected/);
    const [m] = await failed.repo.listMessages(failed.client.id);
    assert.equal(m.status, "failed");
    assert.match(m.error ?? "", /422/);

    const unset = await setup({}, { sms: { ok: false, kind: "config", message: "The text provider refused the request (401). Check the Twilio credentials." } });
    await assert.rejects(sendClientMessage(unset.deps, unset.client.id, { channel: "sms", body: "Hi" }, "staff"), /refused the request \(401\)/);
    assert.equal((await unset.repo.listMessages(unset.client.id)).length, 0);
  });

  test("an office that can't text yet is told why, and nothing is sent or recorded", async () => {
    const { deps, client, texts, repo } = await setup();
    deps.sms = { sender: null, problem: "This office has no texting number yet. Choose one in Settings → Text messaging.", credits: null };
    await assert.rejects(sendClientMessage(deps, client.id, { channel: "sms", body: "Hi" }, "staff"), /no texting number/);
    assert.equal(texts.length, 0);
    assert.equal((await repo.listMessages(client.id)).length, 0);
  });

  test("an office on credits spends one per segment; a refused text gives them back; too few credits stops the send", async () => {
    const ledger: { delta: number; ref: string }[] = [{ delta: 3, ref: "grant" }];
    const credits = {
      balance: async () => ledger.reduce((n, e) => n + e.delta, 0),
      spend: async (n: number, ref: string) => { if (ledger.reduce((t, e) => t + e.delta, 0) < n) return false; ledger.push({ delta: -n, ref }); return true; },
      refund: async (n: number, ref: string) => { ledger.push({ delta: n, ref }); },
    };
    const ok = await setup();
    ok.deps.sms.credits = credits;
    const m = await sendClientMessage(ok.deps, ok.client.id, { channel: "sms", body: "x".repeat(200) }, "staff");
    assert.equal(m.segments, 2);
    assert.equal(await credits.balance(), 1);

    await assert.rejects(sendClientMessage(ok.deps, ok.client.id, { channel: "sms", body: "x".repeat(200) }, "staff"), /needs 2 and this office has 1/);
    assert.equal(ok.texts.length, 1, "nothing sent without credits");

    const refused = await setup({}, { sms: { ok: false, kind: "permanent", message: "The text provider rejected the message (400)." } });
    refused.deps.sms.credits = credits;
    await assert.rejects(sendClientMessage(refused.deps, refused.client.id, { channel: "sms", body: "Hi" }, "staff"), /Not sent/);
    assert.equal(await credits.balance(), 1, "the credit came back");
  });

  test("outside production only test-list addresses are contacted", async () => {
    const { deps, client, emails, texts } = await setup({ env: "preview", testRecipients: ["someone.else@example.com", "337-555-0100"] });
    await assert.rejects(sendClientMessage(deps, client.id, { channel: "email", subject: "S", body: "B" }, "staff"), /only contacts addresses on the test list/);
    assert.equal(emails.length, 0);
    await sendClientMessage(deps, client.id, { channel: "sms", body: "Hi" }, "staff");
    assert.equal(texts.length, 1, "a number on the test list is allowed");
  });

  test("it needs a contact detail, a subject for email, a live client and a channel", async () => {
    const { deps, client, repo } = await setup();
    await repo.updateClient(client.id, { email: null, phone: "555" });
    await assert.rejects(sendClientMessage(deps, client.id, { channel: "email", subject: "S", body: "B" }, "staff"), /no valid email/);
    await assert.rejects(sendClientMessage(deps, client.id, { channel: "sms", body: "B" }, "staff"), /no valid mobile/);
    await repo.updateClient(client.id, { email: "test.client@example.com" });
    await assert.rejects(sendClientMessage(deps, client.id, { channel: "email", subject: " ", body: "B" }, "staff"), /subject/);
    await assert.rejects(sendClientMessage(deps, client.id, { channel: "fax", body: "B" }, "staff"), /email or text/);
    await repo.updateClient(client.id, { archived_at: "2026-10-01T00:00:00Z" });
    await assert.rejects(sendClientMessage(deps, client.id, { channel: "email", subject: "S", body: "B" }, "staff"), /archived/);
    await assert.rejects(sendClientMessage(deps, "not-an-id", { channel: "email" }, "staff"), /wasn't found/);
  });

  test("plain email HTML escapes everything", () => {
    assert.equal(plainEmailHtml(`<script>"x"</script>`).includes("<script>"), false);
  });
});
