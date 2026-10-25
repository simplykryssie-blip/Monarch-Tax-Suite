import { ValidationError } from "../commerce/validation.ts";
import type { DocumentFolder, DocumentsRepo, LibraryDocument } from "./types.ts";

// Folders (with sub-folders) for the document library. Same rules as the Pipelines folders.

export const MAX_FOLDER_DEPTH = 4;
const clean = (v: unknown) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) : "");
const idOrNull = (v: unknown) => (typeof v === "string" && v ? v : null);
const depth = (folders: DocumentFolder[], id: string | null): number => {
  let n = 0;
  for (let cur = id; cur; n++) cur = folders.find((f) => f.id === cur)?.parent_id ?? null;
  return n;
};

export async function createFolder(repo: DocumentsRepo, input: { name: unknown; parent_id?: unknown }, actorId: string): Promise<DocumentFolder> {
  const name = clean(input.name), parent_id = idOrNull(input.parent_id);
  if (!name) throw new ValidationError("Give the folder a name.");
  const folders = await repo.listFolders();
  if (parent_id && !folders.some((f) => f.id === parent_id)) throw new ValidationError("That folder wasn't found.");
  if (depth(folders, parent_id) >= MAX_FOLDER_DEPTH) throw new ValidationError(`Folders can go ${MAX_FOLDER_DEPTH} levels deep.`);
  if (folders.some((f) => f.parent_id === parent_id && f.name.toLowerCase() === name.toLowerCase())) throw new ValidationError("A folder with that name is already here.");
  return repo.insertFolder({ name, parent_id, created_by: actorId });
}

export async function renameFolder(repo: DocumentsRepo, id: string, name: unknown): Promise<DocumentFolder> {
  const n = clean(name);
  if (!n) throw new ValidationError("Give the folder a name.");
  const folders = await repo.listFolders();
  const f = folders.find((x) => x.id === id);
  if (!f) throw new ValidationError("That folder wasn't found.");
  if (folders.some((x) => x.id !== id && x.parent_id === f.parent_id && x.name.toLowerCase() === n.toLowerCase())) throw new ValidationError("A folder with that name is already here.");
  return repo.updateFolder(id, { name: n });
}

/** Deletes a folder. What was inside moves up into the folder above it; no document is deleted. */
export async function deleteFolder(repo: DocumentsRepo, id: string): Promise<DocumentFolder> {
  const folders = await repo.listFolders();
  const f = folders.find((x) => x.id === id);
  if (!f) throw new ValidationError("That folder wasn't found.");
  for (const d of await repo.listDocuments()) if (d.folder_id === id) await repo.updateDocument(d.id, { folder_id: f.parent_id });
  for (const child of folders.filter((x) => x.parent_id === id)) await repo.updateFolder(child.id, { parent_id: f.parent_id });
  await repo.removeFolder(id);
  return f;
}

/** Moves a folder inside another folder (or to the top level). A folder can't go inside itself or anything inside it. */
export async function moveFolder(repo: DocumentsRepo, id: string, to: unknown): Promise<DocumentFolder> {
  const folders = await repo.listFolders();
  const f = folders.find((x) => x.id === id);
  if (!f) throw new ValidationError("That folder wasn't found.");
  const parent_id = idOrNull(to);
  if (parent_id && !folders.some((x) => x.id === parent_id)) throw new ValidationError("That folder wasn't found.");
  for (let cur = parent_id; cur; cur = folders.find((x) => x.id === cur)?.parent_id ?? null) if (cur === id) throw new ValidationError("A folder can't go inside itself.");
  if (depth(folders, parent_id) >= MAX_FOLDER_DEPTH) throw new ValidationError(`Folders can go ${MAX_FOLDER_DEPTH} levels deep.`);
  if (folders.some((x) => x.id !== id && x.parent_id === parent_id && x.name.toLowerCase() === f.name.toLowerCase())) throw new ValidationError("A folder with that name is already there.");
  return repo.updateFolder(id, { parent_id });
}

export async function moveDocument(repo: DocumentsRepo, id: string, folderId: unknown): Promise<LibraryDocument> {
  if (!(await repo.getDocument(id))) throw new ValidationError("That document wasn't found.");
  const folder_id = idOrNull(folderId);
  if (folder_id && !(await repo.listFolders()).some((f) => f.id === folder_id)) throw new ValidationError("That folder wasn't found.");
  return repo.updateDocument(id, { folder_id });
}

/** Every folder written as its path ("Engagement letters / 2026"), for a "move to" list. */
export function folderPaths(folders: DocumentFolder[]): { id: string; path: string }[] {
  const path = (f: DocumentFolder): string => (f.parent_id ? `${path(folders.find((x) => x.id === f.parent_id) ?? f)} / ${f.name}` : f.name);
  return folders.map((f) => ({ id: f.id, path: path(f) })).sort((a, b) => a.path.localeCompare(b.path));
}
