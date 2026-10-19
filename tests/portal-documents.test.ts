import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MemoryDocumentStore } from "./documents-memory.ts";
import { makePdf } from "./documents-engine.test.ts";
import { finishPortalUpload, MAX_UPLOADS_PER_DAY, portalDocLink, startPortalUpload, type PortalDoc, type PortalDocDeps, type PortalDocRequest, type PortalDocsRepo } from "../lib/portal/documents.ts";
import { checkPortalFile, cleanPortalName } from "../lib/portal/files.ts";
import { cancelRequest, requestDocument, setDocShared, type PortalStaffRepo, type StaffDoc } from "../lib/portal/staff-docs.ts";

const TENANT = "00000000-0000-4000-8000-0000000000a1";
const CLIENT_A = "00000000-0000-4000-8000-0000000000c1";
const CLIENT_B = "00000000-0000-4000-8000-0000000000c2";
const NOW = new Date("2027-02-01T15:00:00Z");

type Row = PortalDoc & { uploaded_by?: string; created_ms: number };
class Data {
  docs: Row[] = [];
  requests: (PortalDocRequest & { requested_by?: string | null })[] = [];
  tasks: { client_id: string; title: string }[] = [];
  audit: string[] = [];
}
class ClientRepo implements PortalDocsRepo {
  clientId: string;
  private d: Data;
  constructor(d: Data, clientId: string) { this.d = d; this.clientId = clientId; }
  async listVisibleDocs() { return this.d.docs.filter((x) => x.client_id === this.clientId && x.status === "stored" && (x.shared_with_client || x.source === "client")); }
  async getDoc(id: string) { return this.d.docs.find((x) => x.client_id === this.clientId && x.id === id) ?? null; }
  async insertUpload(i: Parameters<PortalDocsRepo["insertUpload"]>[0]) {
    const row: Row = { ...i, client_id: this.clientId, status: "pending", source: "client", shared_with_client: true, created_at: NOW.toISOString(), created_ms: NOW.getTime() };
    this.d.docs.push(row);
    return row;
  }
  async markStored(id: string) { const r = this.d.docs.find((x) => x.client_id === this.clientId && x.id === id)!; r.status = "stored"; return r; }
  async deleteDoc(id: string) { this.d.docs = this.d.docs.filter((x) => !(x.client_id === this.clientId && x.id === id)); }
  async countUploadsSince(iso: string) { return this.d.docs.filter((x) => x.client_id === this.clientId && x.source === "client" && x.created_ms >= Date.parse(iso)).length; }
  async listRequests(status?: PortalDocRequest["status"]) { return this.d.requests.filter((r) => r.client_id === this.clientId && r.status !== "cancelled" && (!status || r.status === status)); }
  async getRequest(id: string) { return this.d.requests.find((r) => r.client_id === this.clientId && r.id === id) ?? null; }
  async markRequestReceived(id: string, at: string) { const r = this.d.requests.find((x) => x.client_id === this.clientId && x.id === id && x.status === "open"); if (r) { r.status = "received"; r.received_at = at; } }
  async addReviewTask(title: string) { this.d.tasks.push({ client_id: this.clientId, title }); }
}
class StaffRepo implements PortalStaffRepo {
  private d: Data;
  constructor(d: Data) { this.d = d; }
  async insertRequest(i: Parameters<PortalStaffRepo["insertRequest"]>[0]) {
    const r: PortalDocRequest = { id: randomUUID(), status: "open", received_at: null, created_at: NOW.toISOString(), ...i };
    this.d.requests.push(r);
    return r;
  }
  async getRequest(id: string) { return this.d.requests.find((r) => r.id === id) ?? null; }
  async setRequestStatus(id: string, status: "cancelled") { this.d.requests.find((r) => r.id === id)!.status = status; }
  async listRequests(clientId: string) { return this.d.requests.filter((r) => r.client_id === clientId); }
  async getDoc(id: string) { return (this.d.docs.find((x) => x.id === id) as StaffDoc | undefined) ?? null; }
  async setShared(id: string, shared: boolean) { this.d.docs.find((x) => x.id === id)!.shared_with_client = shared; }
  async listDocs(clientId: string) { return this.d.docs.filter((x) => x.client_id === clientId) as StaffDoc[]; }
  async getReturnClient(returnId: string) { return returnId === "ret-a" ? CLIENT_A : returnId === "ret-b" ? CLIENT_B : null; }
  async addAudit(i: { action: string }) { this.d.audit.push(i.action); }
}
function setup(clientId = CLIENT_A) {
  const data = new Data();
  const store = new MemoryDocumentStore();
  const deps = (c = clientId): PortalDocDeps => ({ tenantId: TENANT, repo: new ClientRepo(data, c), store, now: () => NOW });
  return { data, store, deps, staff: new StaffRepo(data) };
}
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

describe("portal file checks", () => {
  test("names: PDF, JPG, PNG only", () => {
    assert.deepEqual(cleanPortalName("My W-2 (2025).JPEG"), { fileName: "My W-2 _2025_.JPEG", fileType: "jpg" });
    assert.equal(cleanPortalName("scan.pdf").fileType, "pdf");
    assert.throws(() => cleanPortalName("macro.docm"), /PDF, JPG or PNG/);
    assert.throws(() => cleanPortalName("run.exe"), /PDF, JPG or PNG/);
    assert.throws(() => cleanPortalName(".png"), /Give the file a name/);
  });
  test("content, not the name, decides", async () => {
    await checkPortalFile(PNG, "png");
    await checkPortalFile(JPG, "jpg");
    await assert.rejects(checkPortalFile(PNG, "jpg"), /isn't a real JPG/);
    await assert.rejects(checkPortalFile(new Uint8Array([1, 2, 3]), "png"), /isn't a real PNG/);
    await assert.rejects(checkPortalFile(new Uint8Array(0), "pdf"), /empty/);
    await assert.rejects(checkPortalFile(new Uint8Array([1, 2, 3, 4, 5, 6]), "pdf"));
  });
});

describe("client uploads", () => {
  test("start → put → finish: stored, request closed, staff get a to-do", async () => {
    const { data, store, deps, staff } = setup();
    const req = await requestDocument(staff, CLIENT_A, { title: "2025 W-2", due_on: "2027-03-01" }, "staff1");
    const t = await startPortalUpload(deps(), { fileName: "w2.png", sizeBytes: PNG.byteLength, requestId: req.id }, "u1");
    assert.ok(t.doc.file_path.startsWith(`${TENANT}/clients/${CLIENT_A}/`));
    assert.equal(t.doc.title, "2025 W-2");
    assert.equal(t.contentType, "image/png");
    store.put(t.doc.file_path, PNG, "image/png");
    const done = await finishPortalUpload(deps(), t.doc.id);
    assert.equal(done.status, "stored");
    assert.equal(data.requests[0].status, "received");
    assert.match(data.tasks[0].title, /Review upload from client: 2025 W-2/);
  });

  test("a file that isn't what it says is rejected and removed", async () => {
    const { data, store, deps } = setup();
    const t = await startPortalUpload(deps(), { fileName: "photo.jpg", sizeBytes: 5 }, "u1");
    store.put(t.doc.file_path, new Uint8Array([1, 2, 3, 4, 5]), "image/jpeg");
    await assert.rejects(finishPortalUpload(deps(), t.doc.id), /isn't a real JPG/);
    assert.equal(data.docs.length, 0);
    assert.equal(store.objects.size, 0);
  });

  test("a size mismatch is rejected", async () => {
    const { store, deps } = setup();
    const t = await startPortalUpload(deps(), { fileName: "photo.png", sizeBytes: 999 }, "u1");
    store.put(t.doc.file_path, PNG, "image/png");
    await assert.rejects(finishPortalUpload(deps(), t.doc.id), /size doesn't match/);
  });

  test("a closed request can't be answered; neither can another client's", async () => {
    const { deps, staff } = setup();
    const mine = await requestDocument(staff, CLIENT_A, { title: "1099" }, null);
    const theirs = await requestDocument(staff, CLIENT_B, { title: "Their 1099" }, null);
    await assert.rejects(startPortalUpload(deps(), { fileName: "a.png", sizeBytes: 5, requestId: theirs.id }, "u1"), /no longer open/);
    await cancelRequest(staff, CLIENT_A, mine.id, null);
    await assert.rejects(startPortalUpload(deps(), { fileName: "a.png", sizeBytes: 5, requestId: mine.id }, "u1"), /no longer open/);
  });

  test("size and daily limits", async () => {
    const { deps } = setup();
    await assert.rejects(startPortalUpload(deps(), { fileName: "big.pdf", sizeBytes: 16 * 1024 * 1024 }, "u1"), /15 MB/);
    await assert.rejects(startPortalUpload(deps(), { fileName: "x.pdf", sizeBytes: 0 }, "u1"), /Choose a file/);
    for (let i = 0; i < MAX_UPLOADS_PER_DAY; i++) await startPortalUpload(deps(), { fileName: `f${i}.png`, sizeBytes: 5 }, "u1");
    await assert.rejects(startPortalUpload(deps(), { fileName: "one-more.png", sizeBytes: 5 }, "u1"), /try again tomorrow/);
    // Another client has their own allowance.
    await startPortalUpload(deps(CLIENT_B), { fileName: "ok.png", sizeBytes: 5 }, "u2");
  });

  test("a real PDF passes", async () => {
    const { store, deps } = setup();
    const pdf = await makePdf([]);
    const t = await startPortalUpload(deps(), { fileName: "return.pdf", sizeBytes: pdf.byteLength }, "u1");
    store.put(t.doc.file_path, pdf);
    assert.equal((await finishPortalUpload(deps(), t.doc.id)).status, "stored");
  });
});

describe("what a client can open", () => {
  test("only documents staff shared (or their own uploads), and only their own", async () => {
    const { data, store, deps, staff } = setup();
    const mk = (id: string, client: string, over: Partial<Row>): Row => ({ id, client_id: client, return_id: null, title: id, file_path: `${TENANT}/clients/${client}/${id}.pdf`, file_type: "pdf", size_bytes: 1, status: "stored", source: "staff", shared_with_client: false, request_id: null, created_at: NOW.toISOString(), created_ms: NOW.getTime(), ...over });
    data.docs.push(mk("11111111-1111-4111-8111-111111111111", CLIENT_A, {}), mk("22222222-2222-4222-8222-222222222222", CLIENT_A, { shared_with_client: true }), mk("33333333-3333-4333-8333-333333333333", CLIENT_B, { shared_with_client: true }), mk("44444444-4444-4444-8444-444444444444", CLIENT_A, { source: "client", shared_with_client: true }));
    assert.deepEqual((await deps().repo.listVisibleDocs()).map((d) => d.id).sort(), ["22222222-2222-4222-8222-222222222222", "44444444-4444-4444-8444-444444444444"]);
    await assert.rejects(portalDocLink(deps(), "11111111-1111-4111-8111-111111111111"), /wasn't found/);
    await assert.rejects(portalDocLink(deps(), "33333333-3333-4333-8333-333333333333"), /wasn't found/);
    assert.match(await portalDocLink(deps(), "22222222-2222-4222-8222-222222222222"), /signed/);
    assert.equal(store.signed[0].seconds, 60);
    await setDocShared(staff, CLIENT_A, "11111111-1111-4111-8111-111111111111", true, "staff1");
    assert.match(await portalDocLink(deps(), "11111111-1111-4111-8111-111111111111"), /signed/);
    await setDocShared(staff, CLIENT_A, "11111111-1111-4111-8111-111111111111", false, "staff1");
    await assert.rejects(portalDocLink(deps(), "11111111-1111-4111-8111-111111111111"), /wasn't found/);
    await assert.rejects(setDocShared(staff, CLIENT_A, "33333333-3333-4333-8333-333333333333", true, null), /wasn't found/);
    await assert.rejects(setDocShared(staff, CLIENT_A, "44444444-4444-4444-8444-444444444444", false, null), /own upload/);
  });
});

describe("staff requests", () => {
  test("validates and audits", async () => {
    const { data, staff } = setup();
    await assert.rejects(requestDocument(staff, CLIENT_A, { title: " " }, null), /Say what you need/);
    await assert.rejects(requestDocument(staff, CLIENT_A, { title: "W-2", due_on: "tomorrow" }, null), /year-month-day/);
    await assert.rejects(requestDocument(staff, CLIENT_A, { title: "W-2", return_id: "ret-b" }, null), /isn't this client's/);
    const r = await requestDocument(staff, CLIENT_A, { title: "W-2", return_id: "ret-a", note: "  from your employer " }, "s1");
    assert.equal(r.note, "from your employer");
    assert.equal(r.return_id, "ret-a");
    await assert.rejects(cancelRequest(staff, CLIENT_B, r.id, null), /wasn't found/);
    await cancelRequest(staff, CLIENT_A, r.id, "s1");
    await assert.rejects(cancelRequest(staff, CLIENT_A, r.id, "s1"), /Only an open request/);
    assert.deepEqual(data.audit, ["portal_doc_requested", "portal_doc_request_cancelled"]);
  });
});
