import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MemoryDocumentStore } from "./documents-memory.ts";
import { deleteLeadDocs, leadDocLink, leadDocPath, moveLeadDocsToClient, type LeadDoc, type LeadDocsDb } from "../lib/leads/docs.ts";

// Lead documents: PDFs of forms a lead completed. When the lead becomes a client they move to the client and live there only.

const TENANT = "00000000-0000-4000-8000-0000000000a1";
const LEAD = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3]);

async function setup(docs: { id: string; sub: string | null; title: string }[]) {
  const files = new MemoryDocumentStore();
  const leadDocs: LeadDoc[] = [];
  const clientDocs: { client_id: string; title: string; file_path: string; form_submission_id: string | null }[] = [];
  for (const d of docs) {
    const path = leadDocPath(TENANT, LEAD, d.id, "pdf");
    await files.upload(path, PDF, "application/pdf");
    leadDocs.push({ id: d.id, lead_id: LEAD, title: d.title, file_path: path, file_type: "pdf", size_bytes: PDF.byteLength, form_submission_id: d.sub, uploaded_by: null, created_at: "2026-10-13T10:00:00Z" });
  }
  const db: LeadDocsDb = {
    listLeadDocs: async (id) => leadDocs.filter((d) => d.lead_id === id),
    getLeadDoc: async (id) => leadDocs.find((d) => d.id === id) ?? null,
    deleteLeadDoc: async (id) => { leadDocs.splice(leadDocs.findIndex((d) => d.id === id), 1); },
    clientHasSubmissionDoc: async (sub) => clientDocs.some((c) => c.form_submission_id === sub),
    insertClientDoc: async (input) => { clientDocs.push(input); },
  };
  return { deps: { tenantId: TENANT, db, files }, leadDocs, clientDocs, files };
}

describe("lead documents move to the client and live there only", () => {
  test("converting moves every document: under the client's folder, gone from the lead", async () => {
    const s = await setup([{ id: "d1", sub: "s1", title: "Intake (completed)" }, { id: "d2", sub: "s2", title: "Questionnaire (completed)" }]);
    assert.equal(await moveLeadDocsToClient(s.deps, LEAD, CLIENT), 2);
    assert.deepEqual(s.leadDocs, [], "nothing is left under the lead");
    assert.equal(s.clientDocs.length, 2);
    assert.ok(s.clientDocs.every((c) => c.client_id === CLIENT && c.file_path.startsWith(`${TENANT}/clients/${CLIENT}/`)), "files are in the client's own folder, where client documents are opened from");
    for (const c of s.clientDocs) assert.ok(await s.files.download(c.file_path), "the file is there");
  });

  test("moving again does nothing, and a retry after a partly finished move leaves one copy, not two", async () => {
    const s = await setup([{ id: "d1", sub: "s1", title: "Intake (completed)" }]);
    await moveLeadDocsToClient(s.deps, LEAD, CLIENT);
    assert.equal(await moveLeadDocsToClient(s.deps, LEAD, CLIENT), 0);
    const partial = await setup([{ id: "d1", sub: "s1", title: "Intake (completed)" }]);
    partial.clientDocs.push({ client_id: CLIENT, title: "Intake (completed)", file_path: `${TENANT}/clients/${CLIENT}/x.pdf`, form_submission_id: "s1" });
    await moveLeadDocsToClient(partial.deps, LEAD, CLIENT);
    assert.equal(partial.clientDocs.length, 1, "already on the client: just dropped from the lead");
    assert.deepEqual(partial.leadDocs, []);
  });

  test("if the client's record can't be made, the copied file is removed and the lead keeps its document", async () => {
    const s = await setup([{ id: "d1", sub: "s1", title: "Intake (completed)" }]);
    s.deps.db.insertClientDoc = async () => { throw new Error("database down"); };
    await assert.rejects(moveLeadDocsToClient(s.deps, LEAD, CLIENT), /database down/);
    assert.equal(s.leadDocs.length, 1);
    assert.deepEqual([...s.files.objects.keys()].filter((k) => k.includes("/clients/")), [], "no stray copy under the client");
  });

  test("a file outside the lead's own folder is refused, and download links are checked the same way", async () => {
    const s = await setup([{ id: "d1", sub: null, title: "Intake" }]);
    s.leadDocs[0].file_path = "00000000-0000-4000-8000-0000000000b2/leads/x/d1.pdf";
    await assert.rejects(moveLeadDocsToClient(s.deps, LEAD, CLIENT), /Refused/);
    await assert.rejects(leadDocLink(s.deps, "d1"), /wasn't found|Refused/);
  });

  test("deleting a lead removes its documents", async () => {
    const s = await setup([{ id: "d1", sub: "s1", title: "Intake" }]);
    await deleteLeadDocs(s.deps, LEAD);
    assert.deepEqual(s.leadDocs, []);
  });
});

describe("every route from lead to client moves the documents", () => {
  const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  test("convert (one and in bulk), the already-a-client case, and both merge paths", () => {
    assert.match(read("lib/contacts/convert.ts"), /await moveDocs\?\.\(lead\.id, existing\.id\)/);
    assert.match(read("lib/contacts/convert.ts"), /await moveDocs\?\.\(lead\.id, client\.id\)/);
    assert.match(read("app/(admin)/contacts/convert-actions.ts"), /moveLeadDocs\)/);
    assert.match(read("app/(admin)/contacts/bulk-actions.ts"), /actor, moveLeadDocs\)/);
    assert.match(read("app/(admin)/contacts/merge-actions.ts"), /moveLeadDocs\(drop, keep\)/);
    assert.match(read("app/(admin)/workspace/actions.ts"), /moveLeadDocs\(leadId, clientId\)/);
  });
});
