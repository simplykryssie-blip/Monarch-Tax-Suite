import { KINDS, type NewNotification } from "../notifications/types.ts";
import type { Delivery, LibraryDocument, SignatureRequest } from "./types.ts";

// The bell's wording for what happens to a document that was sent.

/** Where to look: the client's Documents tab when it was sent to a client, else the document's Sent copies. */
const hrefFor = (d: Delivery, doc: LibraryDocument) => (d.client_id ? `/workspace/clients/${d.client_id}?tab=documents` : `/documents/${doc.id}?tab=sent`);
const who = (d: Delivery, r?: SignatureRequest | null) => r?.signed_name || r?.signer_name || d.recipient_name || d.recipient_email;

export function documentOpenedNotice(d: Delivery, doc: LibraryDocument): NewNotification {
  return { kind: KINDS.documentOpened, title: `${who(d)} opened ${doc.name}`, href: hrefFor(d, doc), clientId: d.client_id ?? null, dedupeKey: `document:opened:${d.id}` };
}
export function documentSignedNotice(d: Delivery, doc: LibraryDocument, r: SignatureRequest): NewNotification {
  return { kind: KINDS.documentSigned, title: `${who(d, r)} signed ${doc.name}`, href: hrefFor(d, doc), clientId: d.client_id ?? null, dedupeKey: `document:signed:${r.id}` };
}
export function documentDeclinedNotice(d: Delivery, doc: LibraryDocument, r: SignatureRequest): NewNotification {
  return { kind: KINDS.documentDeclined, title: `${who(d, r)} declined to sign ${doc.name}`, detail: r.decline_reason, href: hrefFor(d, doc), clientId: d.client_id ?? null, dedupeKey: `document:declined:${r.id}` };
}
