import { createHash, randomUUID } from "node:crypto";
import { isTimeZone, parseYmd, zonedToUtc, type BusinessCalendar } from "../calendar/business.ts";
import { ValidationError } from "../commerce/validation.ts";
import { checkEmail, checkName, checkPhone } from "../leads/service.ts";
import { matchPerson, type PeopleDeps } from "../people/match.ts";
import type { AppointmentActivity } from "./activity.ts";
import { cancellationFrom, confirmationFrom, reminderFrom } from "./messages.ts";
import { availableSlots, slotIsOffered, type Rule, type Slot } from "./slots.ts";
import { OverlapError, type Appointment, type AppointmentRepo, type AppointmentType, type BookingMessages, type NewReminder, type Notifier, type TypeInput } from "./types.ts";

// Booking, rescheduling, cancelling and reminding. Staff and the public use the same rules; the database refuses two
// bookings that overlap for the same staff member, so two people picking the same time can't both get it.

export type AppointmentDeps = {
  tenantId: string;
  repo: AppointmentRepo;
  calendar: () => Promise<BusinessCalendar>;
  people: PeopleDeps;
  notify: Notifier;
  firmName: () => Promise<string>;
  /** The firm's name, address, phone and email, added to the bottom of every email. */
  firmSignature?: () => Promise<string>;
  /** The secret link for one appointment: the same every time for the same id, impossible to guess. */
  /** The public link to an intake form, or null when it has none (not published, no web address). */
  intakeLink?: (formId: string) => Promise<string | null>;
  tokenFor: (appointmentId: string) => string;
  manageUrl: (token: string) => Promise<string>;
  /** Raised for the Automation Center. Never allowed to fail a booking. */
  emit?: (type: string, appointment: Appointment) => Promise<void>;
  /** Told when an appointment is booked, moved or cancelled, for the bell. Never allowed to fail the change. */
  activity?: (e: AppointmentActivity) => Promise<void>;
  now?: () => Date;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIN = 60_000;
const nowOf = (d: AppointmentDeps) => d.now?.() ?? new Date();
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const line = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
const para = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").trim().slice(0, max) : "");
const int = (v: unknown, label: string, min: number, max: number, dflt: number) => {
  if (v === undefined || v === null || v === "") return dflt;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new ValidationError(`${label} must be a whole number from ${min} to ${max}.`);
  return n;
};
/** An email body with the firm's details added at the bottom. */
const signed = async (d: AppointmentDeps, text: string): Promise<string> => {
  const sig = await d.firmSignature?.().catch(() => "");
  return sig ? `${text}\n\n--\n${sig}` : text;
};
/** A confirmation with the intake form link added when the appointment type asks for one. */
const withIntake = async (d: AppointmentDeps, t: AppointmentType, text: string): Promise<string> => {
  const link = t.intake_form_id ? await d.intakeLink?.(t.intake_form_id).catch(() => null) : null;
  return link ? `${text}\n\nBefore your visit, please fill in this form: ${link}` : text;
};
const told = async (d: AppointmentDeps, e: AppointmentActivity) => { try { await d.activity?.(e); } catch { /* the bell is a courtesy */ } };
const emitSafe = async (d: AppointmentDeps, type: string, a: Appointment) => { try { await d.emit?.(type, a); } catch { /* an automation problem never fails a booking */ } };

// ---------------------------------------------------------------- appointment types

export const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");

export function checkType(raw: Record<string, unknown>): TypeInput {
  const name = line(raw.name, 120);
  if (!name) throw new ValidationError("Give the appointment type a name.");
  const slug = (line(raw.slug, 40) || slugOf(name)).toLowerCase();
  if (!/^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/.test(slug)) throw new ValidationError("The link name can use lowercase letters, numbers and dashes (for example tax-prep-consult).");
  const hours = typeof raw.reminder_hours === "string" ? raw.reminder_hours.split(/[,\s]+/).filter(Boolean).map(Number) : Array.isArray(raw.reminder_hours) ? raw.reminder_hours.map(Number) : [24];
  if (hours.length > 3 || hours.some((h) => !Number.isInteger(h) || h < 1 || h > 336)) throw new ValidationError("Reminders: up to three, each a whole number of hours before the appointment (1 to 336), for example 24, 2.");
  const assignee = line(raw.assignee_id, 40);
  if (assignee && !UUID.test(assignee)) throw new ValidationError("Choose a staff member from the list.");
  const intake = line(raw.intake_form_id, 40);
  if (intake && !UUID.test(intake)) throw new ValidationError("Choose a form from the list.");
  return {
    slug, name, description: para(raw.description, 2000) || null, location: line(raw.location, 300) || null,
    duration_minutes: int(raw.duration_minutes, "Length", 5, 480, 30),
    buffer_before_minutes: int(raw.buffer_before_minutes, "Time before", 0, 120, 0),
    buffer_after_minutes: int(raw.buffer_after_minutes, "Time after", 0, 120, 0),
    step_minutes: int(raw.step_minutes, "Start times every", 5, 240, 30),
    min_notice_minutes: int(raw.min_notice_minutes, "Minimum notice", 0, 43200, 120),
    max_days_ahead: int(raw.max_days_ahead, "Book up to", 1, 365, 60),
    reminder_hours: [...new Set(hours)], assignee_id: assignee || null, intake_form_id: intake || null, active: raw.active === undefined ? true : raw.active === true || raw.active === "on" || raw.active === "true",
  };
}

export async function createType(d: AppointmentDeps, raw: Record<string, unknown>): Promise<AppointmentType> {
  const input = checkType(raw);
  if (await d.repo.getTypeBySlug(input.slug)) throw new ValidationError("Another appointment type already uses that link name.");
  return d.repo.insertType(input);
}
export async function editType(d: AppointmentDeps, id: string, raw: Record<string, unknown>): Promise<AppointmentType> {
  const current = UUID.test(id) ? await d.repo.getType(id) : null;
  if (!current) throw new ValidationError("That appointment type wasn't found.");
  const input = checkType({ ...raw, active: raw.active ?? false });
  const clash = await d.repo.getTypeBySlug(input.slug);
  if (clash && clash.id !== id) throw new ValidationError("Another appointment type already uses that link name.");
  return d.repo.updateType(id, input);
}

/** Archives a type (closed for booking, kept with its past appointments and moved out of the way) or brings it back. */
export async function setTypeArchived(d: AppointmentDeps, id: string, archived: boolean): Promise<AppointmentType> {
  const current = UUID.test(id) ? await d.repo.getType(id) : null;
  if (!current) throw new ValidationError("That appointment type wasn't found.");
  return d.repo.updateType(id, { active: !archived });
}

// ---------------------------------------------------------------- availability

const hhmm = (v: unknown, label: string) => {
  const s = typeof v === "string" ? v.trim() : "";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) throw new ValidationError(`${label} must be a time like 09:00.`);
  return s;
};

/** Replaces the weekly hours. `raw` maps weekday (0 Sunday to 6) to a list of [from, to] pairs; a missing day is closed. */
export async function saveWeekly(d: AppointmentDeps, assigneeId: string | null, raw: Record<number, [string, string][]>): Promise<void> {
  const rows: { weekday: number; start_time: string; end_time: string }[] = [];
  for (let day = 0; day < 7; day++) {
    const spans = (raw[day] ?? []).map(([a, b]) => [hhmm(a, "Start"), hhmm(b, "End")] as const).sort((x, y) => x[0].localeCompare(y[0]));
    spans.forEach(([a, b], i) => {
      if (a >= b) throw new ValidationError("Each period must end after it starts.");
      if (i > 0 && spans[i - 1][1] > a) throw new ValidationError("Periods on the same day can't overlap.");
      rows.push({ weekday: day, start_time: a, end_time: b });
    });
  }
  await d.repo.replaceWeekly(assigneeId, rows);
}

export async function addDateOverride(d: AppointmentDeps, assigneeId: string | null, raw: { date?: unknown; closed?: unknown; from?: unknown; to?: unknown }): Promise<void> {
  const date = typeof raw.date === "string" ? raw.date : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`))) throw new ValidationError("Choose a date.");
  const closed = raw.closed === true || raw.closed === "on";
  if (closed) return d.repo.addDateRule(assigneeId, { on_date: date, closed: true, start_time: null, end_time: null });
  const from = hhmm(raw.from, "Start"), to = hhmm(raw.to, "End");
  if (from >= to) throw new ValidationError("The day must end after it starts.");
  await d.repo.addDateRule(assigneeId, { on_date: date, closed: false, start_time: from, end_time: to });
}

/** The rules that apply to a type: its staff member's own, or the office's when that person has none. */
async function rulesFor(d: AppointmentDeps, assigneeId: string | null): Promise<Rule[]> {
  const own = assigneeId ? await d.repo.listRules(assigneeId) : [];
  return own.length ? own : d.repo.listRules(null);
}

// ---------------------------------------------------------------- finding times

export async function listSlots(d: AppointmentDeps, type: AppointmentType, fromDate: string, days: number, exceptId?: string): Promise<Slot[]> {
  if (!type.active) return [];
  const now = nowOf(d);
  const [cal, rules] = await Promise.all([d.calendar(), rulesFor(d, type.assignee_id)]);
  const busy = await d.repo.listBusy(type.assignee_id, new Date(now.getTime() - 86_400_000), new Date(now.getTime() + (type.max_days_ahead + 2) * 86_400_000), exceptId);
  return availableSlots(cal, rules, type, busy, now, fromDate, days);
}

async function offered(d: AppointmentDeps, type: AppointmentType, start: Date, exceptId?: string): Promise<Slot> {
  const now = nowOf(d);
  const [cal, rules] = await Promise.all([d.calendar(), rulesFor(d, type.assignee_id)]);
  const busy = await d.repo.listBusy(type.assignee_id, new Date(start.getTime() - 86_400_000), new Date(start.getTime() + 2 * 86_400_000), exceptId);
  const slot = slotIsOffered(cal, rules, type, busy, now, start);
  if (!slot) throw new ValidationError("That time is no longer available. Please pick another.");
  return slot;
}

const parseStart = (raw: unknown): Date => {
  const t = typeof raw === "string" ? Date.parse(raw) : NaN;
  if (Number.isNaN(t)) throw new ValidationError("Choose a time.");
  return new Date(t);
};

// ---------------------------------------------------------------- booking

/** How the confirmation went. sms null = not attempted (no number, or no text consent). */
export type ConfirmationOutcome = { email: { ok: boolean; message?: string }; sms: { ok: boolean; message?: string } | null };
export type Booked = { appointment: Appointment; token: string; confirmation: ConfirmationOutcome };

const outcomeOf = (r: { ok: true } | { ok: false; message: string }) => (r.ok ? { ok: true } : { ok: false, message: r.message });
const failure = (e: unknown) => ({ ok: false, message: e instanceof Error ? e.message.slice(0, 200) : "Could not send." });

/** Sends the confirmation by email (and by text to someone who agreed to texts). Never throws: the result says what happened. */
async function sendConfirmation(d: AppointmentDeps, t: AppointmentType, saved: Appointment, token: string): Promise<ConfirmationOutcome> {
  let c: ReturnType<typeof confirmationFrom>;
  let text: string;
  try {
    c = confirmationFrom(saved, t, await d.firmName(), await d.manageUrl(token), await d.repo.getMessages().catch(() => null));
    text = await signed(d, await withIntake(d, t, c.text));
  } catch (e) {
    const f = failure(e);
    console.error(JSON.stringify({ event: "appointment_confirmation_failed", appointment: saved.id, channel: "prepare", message: f.message }));
    return { email: f, sms: null };
  }
  let email: { ok: boolean; message?: string };
  try { email = outcomeOf(await d.notify.email(saved.contact_email, c.subject, text)); } catch (e) { email = failure(e); }
  let sms: { ok: boolean; message?: string } | null = null;
  // The text goes only to someone who agreed to texts and gave a number.
  if (saved.sms_consent && saved.contact_phone) {
    try { sms = outcomeOf(await d.notify.sms(saved.contact_phone, c.sms)); } catch (e) { sms = failure(e); }
  }
  if (!email.ok) console.error(JSON.stringify({ event: "appointment_confirmation_failed", appointment: saved.id, channel: "email", message: email.message }));
  if (sms && !sms.ok) console.error(JSON.stringify({ event: "appointment_confirmation_failed", appointment: saved.id, channel: "sms", message: sms.message }));
  return { email, sms };
}

/** Sends the confirmation again for an upcoming booked appointment. */
export async function resendConfirmation(d: AppointmentDeps, id: string): Promise<ConfirmationOutcome> {
  const a = await d.repo.getAppointment(id);
  if (!a) throw new ValidationError("That appointment was not found.");
  if (a.status !== "booked" || Date.parse(a.starts_at) <= nowOf(d).getTime()) throw new ValidationError("Only upcoming booked appointments can be confirmed again.");
  const t = await d.repo.getType(a.type_id);
  if (!t) throw new ValidationError("That appointment type was not found.");
  return sendConfirmation(d, t, a, d.tokenFor(a.id));
}

function remindersFor(a: Appointment, t: AppointmentType, now: Date): NewReminder[] {
  const out: NewReminder[] = [];
  for (const h of t.reminder_hours) {
    const at = new Date(Date.parse(a.starts_at) - h * 3_600_000);
    if (at.getTime() <= now.getTime()) continue;
    out.push({ appointment_id: a.id, channel: "email", send_at: at.toISOString() });
    if (a.sms_consent && a.contact_phone) out.push({ appointment_id: a.id, channel: "sms", send_at: at.toISOString() });
  }
  return out;
}

async function insertBooked(d: AppointmentDeps, t: AppointmentType, input: {
  start: Date; slot: Slot | null; name: string; email: string; phone: string | null; smsConsent: boolean; clientTz: string | null;
  notes: string | null; source: "public" | "staff"; actorId: string | null; clientId?: string | null; assigneeId?: string | null; sourceLabel: string;
}): Promise<Booked> {
  const now = nowOf(d);
  const cal = await d.calendar();
  const end = input.slot?.end ?? new Date(input.start.getTime() + t.duration_minutes * MIN);
  const blockStart = input.slot?.blockStart ?? new Date(input.start.getTime() - t.buffer_before_minutes * MIN);
  const blockEnd = input.slot?.blockEnd ?? new Date(end.getTime() + t.buffer_after_minutes * MIN);
  // The same person, whichever record they are: updated if known, saved as a lead if new.
  const match = await matchPerson(d.people, { email: input.email, name: input.name, phone: input.phone, source: input.sourceLabel, tag: "booked", event: "booked" });
  const ref = match.matches.find((m) => m.kind === "client") ?? match.matches.find((m) => m.kind === "lead") ?? match.created;
  const id = randomUUID();
  const token = d.tokenFor(id);
  let saved: Appointment;
  try {
    saved = await d.repo.insertAppointment({
      id, type_id: t.id, assignee_id: input.assigneeId ?? t.assignee_id, starts_at: input.start.toISOString(), ends_at: end.toISOString(),
      block_start: blockStart.toISOString(), block_end: blockEnd.toISOString(), office_time_zone: cal.timeZone, client_time_zone: input.clientTz,
      status: "booked", source: input.source, contact_name: input.name, contact_email: input.email, contact_phone: input.phone,
      client_id: input.clientId ?? (ref?.kind === "client" ? ref.id : null), lead_id: ref?.kind === "lead" ? ref.id : null,
      sms_consent: input.smsConsent, sms_consent_at: input.smsConsent ? now.toISOString() : null, notes: input.notes,
      cancel_reason: null, cancelled_at: null, manage_token_hash: hashToken(token), created_by: input.actorId,
    });
  } catch (e) {
    if (e instanceof OverlapError) throw new ValidationError("That time was just taken. Please pick another.");
    throw e;
  }
  await d.repo.insertReminders(remindersFor(saved, t, now));
  await emitSafe(d, "appointment.booked", saved);
  await told(d, { kind: "booked", appointment: saved, type: t, by: input.source === "public" ? "client" : "staff", actorId: input.actorId });
  // The confirmation is a courtesy: if it can't be sent the booking still stands, and the result says so.
  const confirmation = await sendConfirmation(d, t, saved, token);
  return { appointment: saved, token, confirmation };
}

const MESSAGE_GROUPS = {
  confirm: [["confirm_subject", 200, "The subject"], ["confirm_body", 4000, "The email"], ["confirm_sms", 320, "The text"]],
  reminder: [["reminder_subject", 200, "The subject"], ["reminder_body", 4000, "The email"], ["reminder_sms", 320, "The text"]],
  cancel: [["cancel_subject", 200, "The subject"], ["cancel_body", 4000, "The email"]],
} as const;

/** One group of messages Settings saves (confirmation, reminder or cancellation); the others are left as they are. A message left empty goes back to the built-in wording. */
export async function saveBookingMessages(d: AppointmentDeps, raw: Record<string, unknown>, actorId: string | null): Promise<void> {
  const pick = (v: unknown, max: number, label: string) => {
    const s = para(v, max);
    if (typeof v === "string" && v.trim().length > max) throw new ValidationError(`${label} can be up to ${max} characters.`);
    return s || null;
  };
  const group = typeof raw.group === "string" && raw.group in MESSAGE_GROUPS ? (raw.group as keyof typeof MESSAGE_GROUPS) : "confirm";
  const current = (await d.repo.getMessages().catch(() => null)) ?? { confirm_subject: null, confirm_body: null, confirm_sms: null };
  const next: BookingMessages = { ...current };
  for (const [key, max, label] of MESSAGE_GROUPS[group]) next[key] = pick(raw[key], max, label);
  await d.repo.saveMessages(next, actorId);
}

/** A booking from the public page. */
export async function bookPublic(d: AppointmentDeps, slug: string, raw: Record<string, unknown>): Promise<Booked> {
  const t = await d.repo.getTypeBySlug(typeof slug === "string" ? slug : "");
  if (!t || !t.active) throw new ValidationError("This booking page isn't available.");
  const name = checkName(raw.name);
  const email = checkEmail(raw.email);
  const phoneRaw = typeof raw.phone === "string" ? raw.phone.trim() : "";
  const phone = phoneRaw ? checkPhone(phoneRaw) : null;
  const consent = raw.sms_consent === true || raw.sms_consent === "on" || raw.sms_consent === "true";
  if (consent && !phone) throw new ValidationError("Enter a mobile number to get text reminders, or untick the box.");
  const tz = typeof raw.time_zone === "string" && isTimeZone(raw.time_zone) ? raw.time_zone : null;
  const start = parseStart(raw.starts_at);
  const slot = await offered(d, t, start);
  return insertBooked(d, t, { start, slot, name, email, phone, smsConsent: consent, clientTz: tz, notes: para(raw.notes, 1000) || null, source: "public", actorId: null, sourceLabel: `Booking: ${t.name}` });
}

/** A booking made by staff: any time they choose that doesn't overlap another booking. */
export async function bookByStaff(d: AppointmentDeps, actorId: string, raw: Record<string, unknown>): Promise<Booked> {
  const typeId = typeof raw.type_id === "string" ? raw.type_id : "";
  const t = UUID.test(typeId) ? await d.repo.getType(typeId) : null;
  if (!t) throw new ValidationError("Choose an appointment type.");
  const start = parseStart(raw.starts_at);
  const phoneRaw = typeof raw.phone === "string" ? raw.phone.trim() : "";
  const clientId = typeof raw.client_id === "string" && UUID.test(raw.client_id) ? raw.client_id : null;
  const consent = raw.sms_consent === true || raw.sms_consent === "on";
  const phone = phoneRaw ? checkPhone(phoneRaw) : null;
  if (consent && !phone) throw new ValidationError("Enter a mobile number to send text reminders.");
  return insertBooked(d, t, { start, slot: null, name: checkName(raw.name), email: checkEmail(raw.email), phone, smsConsent: consent, clientTz: null, notes: para(raw.notes, 1000) || null, source: "staff", actorId, clientId, sourceLabel: `Booking: ${t.name}` });
}

// ---------------------------------------------------------------- changing a booking

async function byToken(d: AppointmentDeps, token: unknown): Promise<{ a: Appointment; t: AppointmentType }> {
  const hash = typeof token === "string" && /^[A-Za-z0-9_-]{20,128}$/.test(token) ? hashToken(token) : null;
  const a = hash ? await d.repo.getByTokenHash(hash) : null;
  const t = a ? await d.repo.getType(a.type_id) : null;
  if (!a || !t) throw new ValidationError("This link isn't valid. Check that you copied the whole address.");
  return { a, t };
}
export const lookupByToken = (d: AppointmentDeps, token: unknown) => byToken(d, token).catch(() => null);

function assertOpen(d: AppointmentDeps, a: Appointment) {
  if (a.status !== "booked") throw new ValidationError(a.status === "cancelled" ? "This appointment has been cancelled." : "This appointment is already over.");
  if (Date.parse(a.starts_at) <= nowOf(d).getTime()) throw new ValidationError("This appointment has already started, so it can't be changed online. Please call the office.");
}

async function cancelRow(d: AppointmentDeps, a: Appointment, t: AppointmentType, reason: string | null, notifyClient: boolean, by: "client" | "staff", actorId: string | null = null): Promise<Appointment> {
  const saved = await d.repo.updateAppointment(a.id, { status: "cancelled", cancelled_at: nowOf(d).toISOString(), cancel_reason: reason });
  await d.repo.cancelPendingReminders(a.id);
  await emitSafe(d, "appointment.cancelled", saved);
  await told(d, { kind: "cancelled", appointment: saved, type: t, by, actorId });
  if (notifyClient) {
    try { const m = cancellationFrom(saved, t, await d.firmName(), await d.repo.getMessages().catch(() => null)); await d.notify.email(saved.contact_email, m.subject, await signed(d, m.text)); } catch { /* kept */ }
  }
  return saved;
}

export async function cancelByToken(d: AppointmentDeps, token: unknown, reason: unknown): Promise<Appointment> {
  const { a, t } = await byToken(d, token);
  assertOpen(d, a);
  return cancelRow(d, a, t, line(reason, 300) || null, false, "client");
}
export async function cancelByStaff(d: AppointmentDeps, id: string, reason: unknown, notifyClient: boolean, actorId: string | null = null): Promise<Appointment> {
  const a = UUID.test(id) ? await d.repo.getAppointment(id) : null;
  const t = a ? await d.repo.getType(a.type_id) : null;
  if (!a || !t) throw new ValidationError("That appointment wasn't found.");
  if (a.status !== "booked") throw new ValidationError("Only a booked appointment can be cancelled.");
  return cancelRow(d, a, t, line(reason, 300) || null, notifyClient, "staff", actorId);
}

async function move(d: AppointmentDeps, a: Appointment, t: AppointmentType, start: Date, slot: Slot | null, by: "client" | "staff", actorId: string | null = null): Promise<Appointment> {
  const end = slot?.end ?? new Date(start.getTime() + t.duration_minutes * MIN);
  const bs = slot?.blockStart ?? new Date(start.getTime() - t.buffer_before_minutes * MIN);
  const be = slot?.blockEnd ?? new Date(end.getTime() + t.buffer_after_minutes * MIN);
  let saved: Appointment;
  try {
    saved = await d.repo.updateAppointment(a.id, { starts_at: start.toISOString(), ends_at: end.toISOString(), block_start: bs.toISOString(), block_end: be.toISOString() });
  } catch (e) {
    if (e instanceof OverlapError) throw new ValidationError("That time was just taken. Please pick another.");
    throw e;
  }
  await d.repo.cancelPendingReminders(a.id);
  await d.repo.insertReminders(remindersFor(saved, t, nowOf(d)));
  await emitSafe(d, "appointment.rescheduled", saved);
  await told(d, { kind: "rescheduled", appointment: saved, type: t, by, actorId, from: a.starts_at });
  try {
    const c = confirmationFrom(saved, t, await d.firmName(), await d.manageUrl(d.tokenFor(saved.id)), await d.repo.getMessages().catch(() => null));
    await d.notify.email(saved.contact_email, /^Confirmed/.test(c.subject) ? c.subject.replace("Confirmed", "Rescheduled") : `Rescheduled: ${c.subject}`, await signed(d, await withIntake(d, t, c.text)));
  } catch { /* kept */ }
  return saved;
}

export async function rescheduleByToken(d: AppointmentDeps, token: unknown, startsAt: unknown): Promise<Appointment> {
  const { a, t } = await byToken(d, token);
  assertOpen(d, a);
  const start = parseStart(startsAt);
  return move(d, a, t, start, await offered(d, t, start, a.id), "client");
}
export async function rescheduleByStaff(d: AppointmentDeps, id: string, startsAt: unknown, actorId: string | null = null): Promise<Appointment> {
  const a = UUID.test(id) ? await d.repo.getAppointment(id) : null;
  const t = a ? await d.repo.getType(a.type_id) : null;
  if (!a || !t) throw new ValidationError("That appointment wasn't found.");
  if (a.status !== "booked") throw new ValidationError("Only a booked appointment can be moved.");
  return move(d, a, t, parseStart(startsAt), null, "staff", actorId);
}

/** After the appointment: attended or didn't show. */
export async function markOutcome(d: AppointmentDeps, id: string, outcome: unknown): Promise<Appointment> {
  const a = UUID.test(id) ? await d.repo.getAppointment(id) : null;
  if (!a) throw new ValidationError("That appointment wasn't found.");
  if (outcome !== "done" && outcome !== "no_show") throw new ValidationError("Choose Attended or No-show.");
  if (a.status !== "booked") throw new ValidationError("Only a booked appointment can be marked.");
  if (Date.parse(a.starts_at) > nowOf(d).getTime()) throw new ValidationError("This appointment hasn't started yet.");
  const saved = await d.repo.updateAppointment(a.id, { status: outcome });
  await d.repo.cancelPendingReminders(a.id);
  await emitSafe(d, outcome === "done" ? "appointment.done" : "appointment.no_show", saved);
  return saved;
}

// ---------------------------------------------------------------- reminders

export type ReminderRun = { sent: number; failed: number; skipped: number };

/** Sends the reminders that are due. Called every five minutes by the scheduler. Each reminder is sent once. */
export async function sendDueReminders(d: AppointmentDeps, limit = 50): Promise<ReminderRun> {
  const now = nowOf(d);
  const run: ReminderRun = { sent: 0, failed: 0, skipped: 0 };
  const due = await d.repo.dueReminders(now, limit);
  if (!due.length) return run;
  const firm = await d.firmName();
  const custom = await d.repo.getMessages().catch(() => null);
  for (const r of due) {
    // Claimed first, so two sweeps at once can't both send it.
    if (!(await d.repo.claimReminder(r.id, now))) continue;
    const a = await d.repo.getAppointment(r.appointment_id);
    const t = a ? await d.repo.getType(a.type_id) : null;
    if (!a || !t || a.status !== "booked" || Date.parse(a.starts_at) <= now.getTime()) {
      await d.repo.markReminder(r.id, "skipped", "Appointment is not upcoming", now);
      run.skipped++;
      continue;
    }
    const url = await d.manageUrl(d.tokenFor(a.id));
    let result;
    if (r.channel === "email") {
      const m = reminderFrom(a, t, firm, url, custom);
      result = await d.notify.email(a.contact_email, m.subject, await signed(d, m.text));
    } else if (a.sms_consent && a.contact_phone) {
      result = await d.notify.sms(a.contact_phone, reminderFrom(a, t, firm, url, custom).sms);
    } else {
      await d.repo.markReminder(r.id, "skipped", "No text consent or number", now);
      run.skipped++;
      continue;
    }
    if (result.ok) run.sent++;
    else { await d.repo.markReminder(r.id, "failed", result.message.slice(0, 300), now); run.failed++; }
  }
  return run;
}

/** A date and time typed in a form ("2026-10-12T10:00") as an instant, reading it in the office's time zone. */
export function officeLocalToIso(value: unknown, tz: string): string {
  const m = typeof value === "string" ? /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)$/.exec(value) : null;
  const day = m ? parseYmd(m[1]) : null;
  if (!m || !day) throw new ValidationError("Choose a date and time.");
  return zonedToUtc(day.y, day.m, day.d, Number(m[2]), Number(m[3]), tz).toISOString();
}
