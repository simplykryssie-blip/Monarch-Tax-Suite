import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isMediaPath, legacyPathFromUrl, mediaPathFromUrl, mediaType, mediaUrl, tenantBucket } from "../lib/storage/paths.ts";
import { removeObjects, sweepStorageCleanup } from "../lib/storage/objects.ts";
import { staleThemeImages } from "../lib/forms/theme-images.ts";
import { deleteLibraryImage, emailMarkdown, uploadLibraryImage, type ImagesRepo, type NewTenantImage, type TenantImage } from "../lib/images/service.ts";
import type { ImageStore, ImageType } from "../lib/commerce/types.ts";
import { deleteClientDoc, sweepPendingClientDocs } from "../lib/workspace/docs.ts";
import { plainEmailHtml, sendClientMessage, type SendDeps } from "../lib/workspace/send.ts";
import { smsConfig, smsConfigProblems, toE164, TwilioSmsSender } from "../lib/automation/twilio.ts";
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
function fakeDb(opts: { failRemove?: boolean } = {}) {
  const removed: { bucket: string; paths: string[] }[] = [];
  let queue: { id: string; bucket: string; path: string; attempts: number; last_error?: string }[] = [];
  const db = {
    storage: { from: (bucket: string) => ({ remove: async (paths: string[]) => {
      if (opts.failRemove) return { data: null, error: { message: "storage unavailable" } };
      removed.push({ bucket, paths });
      return { data: [], error: null };
    } }) },
    from: (table: string) => {
      assert.equal(table, "storage_cleanup");
      return {
        upsert: async (rows: { bucket: string; path: string; last_error: string }[]) => {
          for (const r of rows) if (!queue.some((q) => q.bucket === r.bucket && q.path === r.path)) queue.push({ id: `q${queue.length}`, attempts: 0, ...r });
          return { error: null };
        },
        select: () => ({ order: () => ({ limit: async () => ({ data: queue, error: null }) }) }),
        delete: () => ({ in: async (_c: string, ids: string[]) => { queue = queue.filter((q) => !ids.includes(q.id)); return { error: null }; } }),
        update: (patch: { attempts: number }) => ({ eq: async (_c: string, id: string) => { Object.assign(queue.find((q) => q.id === id)!, patch); return { error: null }; } }),
      };
    },
  };
  return { db: db as never, removed, queue: () => queue, heal: () => { opts.failRemove = false; } };
}

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
    assert.equal(store.objects.has(path), false);
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
    assert.equal(store.objects.size, 0);
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

describe("texting through Twilio", () => {
  test("phone numbers become +1… form; unusable ones are refused", () => {
    assert.equal(toE164("(337) 555-0100"), "+13375550100");
    assert.equal(toE164("1-337-555-0100"), "+13375550100");
    assert.equal(toE164("+44 20 7946 0958"), "+442079460958");
    assert.equal(toE164("555-0100"), null);
    assert.equal(toE164(""), null);
  });

  test("missing settings are named, never their values", () => {
    assert.equal(smsConfigProblems(smsConfig({})).length, 3);
    assert.deepEqual(smsConfigProblems(smsConfig({ TWILIO_ACCOUNT_SID: `AC${"a".repeat(32)}`, TWILIO_AUTH_TOKEN: "secret-token", TWILIO_FROM_NUMBER: "+13375550199" })), []);
    assert.ok(smsConfigProblems(smsConfig({ TWILIO_ACCOUNT_SID: "nope", TWILIO_AUTH_TOKEN: "t", TWILIO_FROM_NUMBER: "+1" })).every((p) => !p.includes("secret")));
  });

  test("the request goes to the account's Messages endpoint with basic auth; the token never appears in an error", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const ok = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify({ sid: "SM123" }), { status: 201 }); }) as unknown as typeof fetch;
    const cfg = smsConfig({ TWILIO_ACCOUNT_SID: `AC${"a".repeat(32)}`, TWILIO_AUTH_TOKEN: "secret-token", TWILIO_FROM_NUMBER: "+13375550199" });
    assert.deepEqual(await new TwilioSmsSender(cfg, ok).send("+13375550100", "Hi"), { ok: true, id: "SM123" });
    assert.equal(calls[0].url, `https://api.twilio.com/2010-04-01/Accounts/AC${"a".repeat(32)}/Messages.json`);
    assert.equal(String(calls[0].init.body), "To=%2B13375550100&Body=Hi&From=%2B13375550199");
    const denied = (async () => new Response(JSON.stringify({ message: "Authenticate" }), { status: 401 })) as unknown as typeof fetch;
    const r = await new TwilioSmsSender(cfg, denied).send("+13375550100", "Hi");
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.kind, "config");
    assert.ok(!JSON.stringify(r).includes("secret-token"));
    const none = await new TwilioSmsSender(smsConfig({}), ok).send("+13375550100", "Hi");
    assert.equal(!none.ok && none.kind, "config");
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
      sms: { send: async (to, body) => { texts.push({ to, body }); return results.sms ?? { ok: true, id: "SM1" }; } },
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

    const unset = await setup({}, { sms: { ok: false, kind: "config", message: "Text messaging is not connected. Set TWILIO_ACCOUNT_SID in Vercel (server-side)." } });
    await assert.rejects(sendClientMessage(unset.deps, unset.client.id, { channel: "sms", body: "Hi" }, "staff"), /not connected/);
    assert.equal((await unset.repo.listMessages(unset.client.id)).length, 0);
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
