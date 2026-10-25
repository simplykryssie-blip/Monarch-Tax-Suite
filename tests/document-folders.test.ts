import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryDocumentsRepo } from "./documents-memory.ts";
import { createFolder, deleteFolder, folderPaths, MAX_FOLDER_DEPTH, moveDocument, moveFolder, renameFolder } from "../lib/documents/folders.ts";

const TENANT = "00000000-0000-4000-8000-0000000000a1";

test("folders nest, refuse duplicates and cycles, and deleting one moves its contents up", async () => {
  const repo = new MemoryDocumentsRepo(TENANT);
  const letters = await createFolder(repo, { name: "  Engagement   letters " }, "u1");
  assert.equal(letters.name, "Engagement letters");
  const y2026 = await createFolder(repo, { name: "2026", parent_id: letters.id }, "u1");
  await assert.rejects(createFolder(repo, { name: "engagement LETTERS" }, "u1"), /already here/);
  await assert.rejects(createFolder(repo, { name: "" }, "u1"), /Give the folder a name/);
  await assert.rejects(createFolder(repo, { name: "x", parent_id: "nope" }, "u1"), /wasn't found/);
  assert.deepEqual(folderPaths(await repo.listFolders()).map((f) => f.path), ["Engagement letters", "Engagement letters / 2026"]);

  await assert.rejects(moveFolder(repo, letters.id, y2026.id), /inside itself/);
  await assert.rejects(moveFolder(repo, letters.id, letters.id), /inside itself/);
  await renameFolder(repo, y2026.id, "Tax year 2026");
  await assert.rejects(renameFolder(repo, y2026.id, ""), /Give the folder a name/);

  const doc = await repo.insertDocument({ name: "8879", description: null, file_type: "pdf", created_by: "u1" });
  await moveDocument(repo, doc.id, y2026.id);
  assert.equal((await repo.getDocument(doc.id))!.folder_id, y2026.id);
  await assert.rejects(moveDocument(repo, doc.id, "missing"), /wasn't found/);

  // Deleting the middle folder keeps the document: it moves up to the folder above.
  await deleteFolder(repo, y2026.id);
  assert.equal((await repo.getDocument(doc.id))!.folder_id, letters.id);
  await deleteFolder(repo, letters.id);
  assert.equal((await repo.getDocument(doc.id))!.folder_id, null);
  assert.equal((await repo.listFolders()).length, 0);
});

test("folders go only so deep", async () => {
  const repo = new MemoryDocumentsRepo(TENANT);
  let parent: string | null = null;
  for (let i = 0; i < MAX_FOLDER_DEPTH; i++) parent = (await createFolder(repo, { name: `L${i}`, parent_id: parent }, "u1")).id;
  await assert.rejects(createFolder(repo, { name: "too deep", parent_id: parent }, "u1"), /levels deep/);
});
