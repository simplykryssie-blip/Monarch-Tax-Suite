import type { FolderScope } from "../documents/folders.ts";
import type { DocumentsRepo } from "../documents/types.ts";
import type { WorkspaceRepo } from "./types.ts";

/** One client's folders: their files live in `client_docs`, their sub-folders in `document_folders`. */
export function clientScope(repo: DocumentsRepo, ws: WorkspaceRepo, clientId: string): FolderScope {
  return {
    repo, clientId,
    files: {
      inFolder: async (folderId) => (await ws.listDocs(clientId)).filter((d) => d.folder_id === folderId).map((d) => d.id),
      has: async (id) => (await ws.getDoc(id))?.client_id === clientId,
      setFolder: async (id, folderId) => { await ws.updateDoc(id, { folder_id: folderId }); },
    },
  };
}

/** Only come back to one of the two pages that show a client's folders. */
const SAFE_BACK = /^(\/documents\?client=[0-9a-f-]{36}(&folder=[0-9a-f-]{36})?|\/workspace\/clients\/[0-9a-f-]{36}\?tab=documents(&folder=[0-9a-f-]{36})?)$/i;
export const driveBack = (value: string, fallback: string) => (SAFE_BACK.test(value) ? value : fallback);
