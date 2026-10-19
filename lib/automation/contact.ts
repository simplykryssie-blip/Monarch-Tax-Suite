import type { AutomationEvent, ErrorKind } from "./types.ts";

// The person a workflow run is about. Events hold only an id (an appointment, lead, client, invoice or return); the
// person's details are looked up here when a step runs, so names, emails and numbers are never copied into the event log.

export type Contact = {
  name: string | null;
  email: string | null;
  phone: string | null;
  /** Agreed to texts: on record for this person (an appointment booked with the text-reminder box ticked). */
  smsConsent: boolean;
  leadId: string | null;
  clientId: string | null;
  customerId: string | null;
  tags: string[];
  leadStatus: string | null;
  /** Merge fields for this subject, e.g. appointment_time, invoice_number. */
  variables: Record<string, string>;
};

export type SendTextResult = { ok: true } | { ok: false; kind: ErrorKind; message: string };

/** Everything a workflow step does to people and tasks. The server wires it to the database; tests use a memory copy. */
export interface ContactPort {
  resolve(event: Pick<AutomationEvent, "subject_type" | "subject_id" | "customer_id">): Promise<Contact | null>;
  addTag(contact: Contact, tag: string): Promise<number>;
  removeTag(contact: Contact, tag: string): Promise<number>;
  /** False when the person has no lead record. */
  setLeadStatus(contact: Contact, status: string): Promise<boolean>;
  /** False when this run already made a task with this title (a retried step never doubles up). */
  createTask(task: { title: string; dueOn: string | null; contact: Contact | null; executionId: string }): Promise<boolean>;
  sendText(contact: Contact, body: string, reference: string): Promise<SendTextResult>;
}

/** Condition fields that need the person. */
export const CONTACT_FIELD = /^contact\.(tags|lead_status|is_lead|is_client)$/;
