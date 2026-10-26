import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryDocumentsRepo } from "./documents-memory.ts";
import { clientFolderName, createFolder, deleteFolder, folderPaths, internalScope, MAX_FOLDER_DEPTH, moveFile, moveFolder, renameFolder } from "../lib/documents/folders.ts";
import { clientScope } from "../lib/workspace/doc-folders.ts";
import { MemoryWorkspace } from "./workspace-memory.ts";

const TENANT = "00000000-0000-4000-8000-0000000000a1";

test("folders nest, refuse duplicates and cycles, and deleting one moves its contents up", async () => {
  const repo = new MemoryDocumentsRepo(TENANT);
  const scope = internalScope(repo);
  const letters = await createFolder(scope, { name: "  Engagement   letters " }, "u1");
  assert.equal(letters.name, "Engagement letters");
  const y2026 = await createFolder(scope, { name: "2026", parent_id: letters.id }, "u1");
  await assert.rejects(createFolder(scope, { name: "engagement LETTERS" }, "u1"), /already here/);
  await assert.rejects(createFolder(scope, { name: "" }, "u1"), /Give the folder a name/);
  await assert.rejects(createFolder(scope, { name: "x", parent_id: "nope" }, "u1"), /wasn't found/);
  assert.deepEqual(folderPaths(await repo.listFolders()).map((f) => f.path), ["Engagement letters", "Engagement letters / 2026"]);

  await assert.rejects(moveFolder(scope, letters.id, y2026.id), /inside itself/);
  await assert.rejects(moveFolder(scope, letters.id, letters.id), /inside itself/);
  await renameFolder(scope, y2026.id, "Tax year 2026");
  await assert.rejects(renameFolder(scope, y2026.id, ""), /Give the folder a name/);

  const doc = await repo.insertDocument({ name: "8879", description: null, file_type: "pdf", created_by: "u1" });
  await moveFile(scope, doc.id, y2026.id);
  assert.equal((await repo.getDocument(doc.id))!.folder_id, y2026.id);
  await assert.rejects(moveFile(scope, doc.id, "missing"), /wasn't found/);

  // Deleting the middle folder keeps the document: it moves up to the folder above.
  await deleteFolder(scope, y2026.id);
  assert.equal((await repo.getDocument(doc.id))!.folder_id, letters.id);
  await deleteFolder(scope, letters.id);
  assert.equal((await repo.getDocument(doc.id))!.folder_id, null);
  assert.equal((await repo.listFolders()).length, 0);
});

test("folders go only so deep", async () => {
  const repo = new MemoryDocumentsRepo(TENANT);
  const scope = internalScope(repo);
  let parent: string | null = null;
  for (let i = 0; i < MAX_FOLDER_DEPTH; i++) parent = (await createFolder(scope, { name: `L${i}`, parent_id: parent }, "u1")).id;
  await assert.rejects(createFolder(scope, { name: "too deep", parent_id: parent }, "u1"), /levels deep/);
});

test("a client's folders are their own: separate from internal ones, same rules, and the files follow", async () => {
  const repo = new MemoryDocumentsRepo(TENANT);
  const ws = new MemoryWorkspace();
  const A = "client-a", B = "client-b";
  const file = (id: string, client_id: string) => { ws.docs.push({ id, tenant_id: "t", client_id, return_id: null, title: id, file_path: id, file_type: "pdf", size_bytes: 1, status: "stored", uploaded_by: null, created_at: "2026-01-01T00:00:00Z" } as never); };
  file("a1", A); file("b1", B);
  const a = clientScope(repo, ws, A), b = clientScope(repo, ws, B), office = internalScope(repo);

  const taxes = await createFolder(a, { name: "Taxes" }, "u1");
  await createFolder(office, { name: "Taxes" }, "u1");           // the same name inside the office's folders is fine
  await createFolder(b, { name: "Taxes" }, "u1");                // and inside another client's
  await assert.rejects(createFolder(a, { name: "taxes" }, "u1"), /already here/);
  assert.equal((await repo.listFolders({ clientId: A })).length, 1);
  assert.equal((await repo.listFolders()).length, 1, "internal folders don't include client folders");

  const y2025 = await createFolder(a, { name: "2025", parent_id: taxes.id }, "u1");
  await moveFile(a, "a1", y2025.id);
  assert.equal(ws.docs.find((d) => d.id === "a1")!.folder_id, y2025.id);
  await assert.rejects(moveFile(a, "b1", y2025.id), /wasn't found/);   // another client's file
  await assert.rejects(moveFile(b, "b1", y2025.id), /wasn't found/);   // another client's folder
  await assert.rejects(renameFolder(b, y2025.id, "x"), /wasn't found/);

  await deleteFolder(a, y2025.id);
  assert.equal(ws.docs.find((d) => d.id === "a1")!.folder_id, taxes.id, "its files move up a level");
  await deleteFolder(a, taxes.id);
  assert.equal(ws.docs.find((d) => d.id === "a1")!.folder_id, null);
});

test("a client's own folder is named after them and the last four of their SSN", () => {
  assert.equal(clientFolderName({ full_name: "Jane Smith", ssn_last4: "6789" }), "Jane Smith – 6789");
  assert.equal(clientFolderName({ full_name: "Jane Smith", ssn_last4: null }), "Jane Smith");
});
