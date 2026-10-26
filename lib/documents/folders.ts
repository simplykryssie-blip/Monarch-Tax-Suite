import { ValidationError } from "../commerce/validation.ts";
import type { DocumentFolder, DocumentsRepo } from "./types.ts";

// Folders (with sub-folders) for the Documents area. There are two kinds, and the same rules apply to both:
//   - internal folders, for the office's own documents, and
//   - a client's folders, which hold that client's files (the top of a client's area is the client's own folder, which
//     is not stored: it is named after the client).

export const MAX_FOLDER_DEPTH = 4;
const clean = (v: unknown) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) : "");
const idOrNull = (v: unknown) => (typeof v === "string" && v ? v : null);
const depth = (folders: DocumentFolder[], id: string | null): number => {
  let n = 0;
  for (let cur = id; cur; n++) cur = folders.find((f) => f.id === cur)?.parent_id ?? null;
  return n;
};

/** Where the files are kept: which folder each one is in, and moving one. */
export type FolderFiles = { inFolder(folderId: string): Promise<string[]>; has(id: string): Promise<boolean>; setFolder(id: string, folderId: string | null): Promise<void> };
/** One set of folders: the internal ones (clientId null) or one client's. */
export type FolderScope = { repo: DocumentsRepo; clientId: string | null; files: FolderFiles };

/** The office's internal documents. */
export function internalScope(repo: DocumentsRepo): FolderScope {
  return {
    repo, clientId: null,
    files: {
      inFolder: async (folderId) => (await repo.listDocuments()).filter((d) => d.folder_id === folderId).map((d) => d.id),
      has: async (id) => Boolean(await repo.getDocument(id)),
      setFolder: async (id, folderId) => { await repo.updateDocument(id, { folder_id: folderId }); },
    },
  };
}

const list = (s: FolderScope) => s.repo.listFolders({ clientId: s.clientId });

export async function createFolder(s: FolderScope, input: { name: unknown; parent_id?: unknown }, actorId: string): Promise<DocumentFolder> {
  const name = clean(input.name), parent_id = idOrNull(input.parent_id);
  if (!name) throw new ValidationError("Give the folder a name.");
  const folders = await list(s);
  if (parent_id && !folders.some((f) => f.id === parent_id)) throw new ValidationError("That folder wasn't found.");
  if (depth(folders, parent_id) >= MAX_FOLDER_DEPTH) throw new ValidationError(`Folders can go ${MAX_FOLDER_DEPTH} levels deep.`);
  if (folders.some((f) => f.parent_id === parent_id && f.name.toLowerCase() === name.toLowerCase())) throw new ValidationError("A folder with that name is already here.");
  return s.repo.insertFolder({ name, parent_id, client_id: s.clientId, created_by: actorId });
}

export async function renameFolder(s: FolderScope, id: string, name: unknown): Promise<DocumentFolder> {
  const n = clean(name);
  if (!n) throw new ValidationError("Give the folder a name.");
  const folders = await list(s);
  const f = folders.find((x) => x.id === id);
  if (!f) throw new ValidationError("That folder wasn't found.");
  if (folders.some((x) => x.id !== id && x.parent_id === f.parent_id && x.name.toLowerCase() === n.toLowerCase())) throw new ValidationError("A folder with that name is already here.");
  return s.repo.updateFolder(id, { name: n });
}

/** Deletes a folder. What was inside moves up into the folder above it; no file is deleted. */
export async function deleteFolder(s: FolderScope, id: string): Promise<DocumentFolder> {
  const folders = await list(s);
  const f = folders.find((x) => x.id === id);
  if (!f) throw new ValidationError("That folder wasn't found.");
  for (const fileId of await s.files.inFolder(id)) await s.files.setFolder(fileId, f.parent_id);
  for (const child of folders.filter((x) => x.parent_id === id)) await s.repo.updateFolder(child.id, { parent_id: f.parent_id });
  await s.repo.removeFolder(id);
  return f;
}

/** Moves a folder inside another folder (or to the top level). A folder can't go inside itself or anything inside it. */
export async function moveFolder(s: FolderScope, id: string, to: unknown): Promise<DocumentFolder> {
  const folders = await list(s);
  const f = folders.find((x) => x.id === id);
  if (!f) throw new ValidationError("That folder wasn't found.");
  const parent_id = idOrNull(to);
  if (parent_id && !folders.some((x) => x.id === parent_id)) throw new ValidationError("That folder wasn't found.");
  for (let cur = parent_id; cur; cur = folders.find((x) => x.id === cur)?.parent_id ?? null) if (cur === id) throw new ValidationError("A folder can't go inside itself.");
  if (depth(folders, parent_id) >= MAX_FOLDER_DEPTH) throw new ValidationError(`Folders can go ${MAX_FOLDER_DEPTH} levels deep.`);
  if (folders.some((x) => x.id !== id && x.parent_id === parent_id && x.name.toLowerCase() === f.name.toLowerCase())) throw new ValidationError("A folder with that name is already there.");
  return s.repo.updateFolder(id, { parent_id });
}

/** Moves a file into a folder of this same set (or to the top). */
export async function moveFile(s: FolderScope, id: string, folderId: unknown): Promise<void> {
  if (!(await s.files.has(id))) throw new ValidationError("That file wasn't found.");
  const folder_id = idOrNull(folderId);
  if (folder_id && !(await list(s)).some((f) => f.id === folder_id)) throw new ValidationError("That folder wasn't found.");
  await s.files.setFolder(id, folder_id);
}

/** Every folder written as its path ("Engagement letters / 2026"), for a "move to" list. */
export function folderPaths(folders: DocumentFolder[]): { id: string; path: string }[] {
  const path = (f: DocumentFolder): string => (f.parent_id ? `${path(folders.find((x) => x.id === f.parent_id) ?? f)} / ${f.name}` : f.name);
  return folders.map((f) => ({ id: f.id, path: path(f) })).sort((a, b) => a.path.localeCompare(b.path));
}

/** The name of a client's own folder: their name and the last four digits of their SSN. */
export function clientFolderName(c: { full_name: string; ssn_last4: string | null }): string {
  return c.ssn_last4 ? `${c.full_name} – ${c.ssn_last4}` : c.full_name;
}
