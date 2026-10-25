// The bell: things that happened which the office should know about. Pure types and rules; no server imports.

export type Notification = {
  id: string; tenant_id: string; kind: string; title: string; detail: string | null; href: string;
  client_id: string | null; owner_id: string | null; actor_id: string | null; dedupe_key: string | null;
  read_by: string[]; created_at: string;
};
export type NewNotification = {
  kind: string; title: string; detail?: string | null; href: string; clientId?: string | null; ownerId?: string | null; actorId?: string | null;
  /** One row per real event: reporting the same event twice adds nothing. */
  dedupeKey?: string | null;
};
/** What the bell shows for one person. */
export type BellItem = { id: string; kind: string; title: string; detail: string | null; href: string; at: string; unread: boolean };

export interface NotificationsRepo {
  /** False when a row with this dedupe key already exists. */
  insert(n: Omit<Notification, "id" | "tenant_id" | "read_by" | "created_at">): Promise<boolean>;
  listRecent(limit: number): Promise<Notification[]>;
  markRead(ids: string[], userId: string): Promise<void>;
}

/** Kinds written by the code that raises them. Listed here so the bell can group and describe them. */
export const KINDS = {
  appointmentBooked: "appointment_booked",
  appointmentRescheduled: "appointment_rescheduled",
  appointmentCancelled: "appointment_cancelled",
  documentOpened: "document_opened",
  documentSigned: "document_signed",
  documentDeclined: "document_declined",
  portalUpload: "portal_upload",
  portalMessage: "portal_message",
  portalRequestDone: "portal_request_done",
  formSubmitted: "form_submitted",
  invoicePaid: "invoice_paid",
} as const;
