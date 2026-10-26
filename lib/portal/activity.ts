import { KINDS, type NewNotification } from "../notifications/types.ts";

/** The bell's wording for what a client does in their portal. */
export function portalUploadNotice(client: { id: string; full_name: string; owner_id?: string | null }, doc: { id: string; title: string; request_id?: string | null }): NewNotification {
  const answered = Boolean(doc.request_id);
  return {
    kind: answered ? KINDS.portalRequestDone : KINDS.portalUpload,
    title: answered ? `${client.full_name} sent the document you asked for` : `${client.full_name} uploaded a document`,
    detail: doc.title, href: `/workspace/clients/${client.id}?tab=documents`, clientId: client.id, ownerId: client.owner_id ?? null,
    dedupeKey: `portal:upload:${doc.id}`,
  };
}
