import type { Busy, Rule } from "./slots.ts";

export type AppointmentType = {
  id: string; tenant_id: string; slug: string; name: string; description: string | null; location: string | null;
  duration_minutes: number; buffer_before_minutes: number; buffer_after_minutes: number; step_minutes: number;
  min_notice_minutes: number; max_days_ahead: number; reminder_hours: number[]; assignee_id: string | null; active: boolean;
  created_at: string; updated_at: string;
};
export type TypeInput = Omit<AppointmentType, "id" | "tenant_id" | "created_at" | "updated_at">;

export type AppointmentStatus = "booked" | "cancelled" | "no_show" | "done";
export type Appointment = {
  id: string; tenant_id: string; type_id: string; assignee_id: string | null;
  starts_at: string; ends_at: string; block_start: string; block_end: string;
  office_time_zone: string; client_time_zone: string | null;
  status: AppointmentStatus; source: "public" | "staff";
  contact_name: string; contact_email: string; contact_phone: string | null;
  client_id: string | null; lead_id: string | null;
  sms_consent: boolean; sms_consent_at: string | null;
  notes: string | null; cancel_reason: string | null; cancelled_at: string | null;
  manage_token_hash: string | null; created_by: string | null; created_at: string; updated_at: string;
};
export type NewAppointment = Omit<Appointment, "tenant_id" | "created_at" | "updated_at">;

export type ReminderRow = { id: string; tenant_id: string; appointment_id: string; channel: "email" | "sms"; send_at: string; status: "pending" | "sent" | "failed" | "skipped"; sent_at: string | null; detail: string | null };
export type NewReminder = { appointment_id: string; channel: "email" | "sms"; send_at: string };
export type RuleRow = Rule & { id: string; assignee_id: string | null };

/** Thrown by the repository when the database refuses an overlapping booking. */
export class OverlapError extends Error {}

/** The confirmation messages an office has edited. A null field uses the built-in wording. */
export type BookingMessages = { confirm_subject: string | null; confirm_body: string | null; confirm_sms: string | null };

export interface AppointmentRepo {
  getMessages(): Promise<BookingMessages | null>;
  saveMessages(m: BookingMessages, actorId: string | null): Promise<void>;
  listTypes(): Promise<AppointmentType[]>;
  getType(id: string): Promise<AppointmentType | null>;
  getTypeBySlug(slug: string): Promise<AppointmentType | null>;
  insertType(input: TypeInput): Promise<AppointmentType>;
  updateType(id: string, patch: Partial<TypeInput>): Promise<AppointmentType>;

  listRules(assigneeId: string | null): Promise<RuleRow[]>;
  replaceWeekly(assigneeId: string | null, rows: { weekday: number; start_time: string; end_time: string }[]): Promise<void>;
  addDateRule(assigneeId: string | null, row: { on_date: string; closed: boolean; start_time: string | null; end_time: string | null }): Promise<void>;
  removeRule(id: string): Promise<void>;

  /** Block ranges of booked appointments for one staff member (null = the office) that touch the window. */
  listBusy(assigneeId: string | null, from: Date, to: Date, exceptId?: string): Promise<Busy[]>;
  insertAppointment(row: NewAppointment): Promise<Appointment>;
  getAppointment(id: string): Promise<Appointment | null>;
  getByTokenHash(hash: string): Promise<Appointment | null>;
  updateAppointment(id: string, patch: Partial<Appointment>): Promise<Appointment>;
  listAppointments(from: Date, to: Date): Promise<Appointment[]>;
  listForContact(email: string): Promise<Appointment[]>;

  insertReminders(rows: NewReminder[]): Promise<void>;
  cancelPendingReminders(appointmentId: string): Promise<void>;
  dueReminders(now: Date, limit: number): Promise<ReminderRow[]>;
  /** Takes a pending reminder for sending (marks it sent). False when another sweep already took it. */
  claimReminder(id: string, now: Date): Promise<boolean>;
  markReminder(id: string, status: "sent" | "failed" | "skipped", detail: string | null, now: Date): Promise<void>;
}

export type NotifyResult = { ok: true } | { ok: false; message: string };
export type Notifier = {
  email(to: string, subject: string, text: string): Promise<NotifyResult>;
  sms(to: string, body: string): Promise<NotifyResult>;
};
