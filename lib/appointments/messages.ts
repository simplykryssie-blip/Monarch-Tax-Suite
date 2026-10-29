import type { Appointment, AppointmentType } from "./types.ts";

// The words in confirmations, reminders and the calendar file. Pure.

const fmt = (iso: string, tz: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: tz, ...opts }).format(new Date(iso));

/** "Tuesday, October 13 at 2:00 PM EDT", in the given zone. */
export function when(iso: string, tz: string): string {
  return `${fmt(iso, tz, { weekday: "long", month: "long", day: "numeric" })} at ${fmt(iso, tz, { hour: "numeric", minute: "2-digit", timeZoneName: "short" })}`;
}
/** The time as the client sees it, plus the office's when the zones differ. */
export function whenFor(a: Pick<Appointment, "starts_at" | "office_time_zone" | "client_time_zone">): string {
  const tz = a.client_time_zone ?? a.office_time_zone;
  const main = when(a.starts_at, tz);
  return tz === a.office_time_zone ? main : `${main} (${fmt(a.starts_at, a.office_time_zone, { hour: "numeric", minute: "2-digit", timeZoneName: "short" })} at the office)`;
}

// ---------------------------------------------------------------- confirmations an office can edit

export const DEFAULT_CONFIRM_SUBJECT = "Confirmed: {{type}} with {{office}}";
export const DEFAULT_CONFIRM_BODY = "Hi {{name}},\n\nYour {{type}} with {{office}} is booked for {{date_time}}.\n\n{{location_line}}\n\nNeed to change it? Cancel or pick another time here: {{manage_link}}\n\n{{office}}";
export const DEFAULT_CONFIRM_SMS = "{{office}}: your {{type}} is booked for {{date_time}}. Change it: {{manage_link}} Reply STOP to opt out.";
/** What can go between double braces in a confirmation. */
export const CONFIRM_FIELDS: Record<string, string> = {
  name: "The client's name", first_name: "Their first name", type: "The appointment type", office: "Your firm's name", date_time: "The day and time",
  location: "Where it is", location_line: "\"Where: ...\", or nothing when there is no location", manage_link: "The link to cancel or change it",
};

/** Fills {{placeholders}} in a message. An unknown placeholder is left out; blank lines left behind are tidied. */
export function fillMessage(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, k: string) => values[k] ?? "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export const DEFAULT_REMINDER_SUBJECT = "Reminder: {{type}} on {{date_time}}";
export const DEFAULT_REMINDER_BODY = "Hi {{name}},\n\nThis is a reminder of your {{type}} with {{office}}: {{date_time}}.\n\n{{location_line}}\n\nCan't make it? Cancel or reschedule here: {{manage_link}}\n\n{{office}}";
export const DEFAULT_REMINDER_SMS = "{{office}}: reminder of your {{type}} on {{date_time}}. Change it: {{manage_link}} Reply STOP to opt out.";
export const DEFAULT_CANCEL_SUBJECT = "Cancelled: {{type}} with {{office}}";
export const DEFAULT_CANCEL_BODY = "Hi {{name}},\n\nYour {{type}} on {{date_time}} has been cancelled.\n\n{{office}}";

function valuesFor(a: Appointment, t: AppointmentType, firm: string, manageUrl: string, dateTime: string): Record<string, string> {
  return {
    name: a.contact_name, first_name: a.contact_name.split(" ")[0] ?? a.contact_name, type: t.name, office: firm, date_time: dateTime,
    location: t.location ?? "", location_line: t.location ? `Where: ${t.location}` : "", manage_link: manageUrl,
  };
}

export type ConfirmationSet = { subject: string; text: string; sms: string };
/** The confirmation email and text for a booking: the office's own wording where it has written some, else the built-in one. */
export function confirmationFrom(a: Appointment, t: AppointmentType, firm: string, manageUrl: string, custom: { confirm_subject: string | null; confirm_body: string | null; confirm_sms: string | null } | null): ConfirmationSet {
  const values: Record<string, string> = {
    name: a.contact_name, first_name: a.contact_name.split(" ")[0] ?? a.contact_name, type: t.name, office: firm, date_time: whenFor(a),
    location: t.location ?? "", location_line: t.location ? `Where: ${t.location}` : "", manage_link: manageUrl,
  };
  return {
    subject: fillMessage(custom?.confirm_subject || DEFAULT_CONFIRM_SUBJECT, values),
    text: fillMessage(custom?.confirm_body || DEFAULT_CONFIRM_BODY, values),
    sms: fillMessage(custom?.confirm_sms || DEFAULT_CONFIRM_SMS, values),
  };
}

export function confirmationEmail(a: Appointment, t: AppointmentType, firm: string, manageUrl: string): { subject: string; text: string } {
  return {
    subject: `Confirmed: ${t.name} with ${firm}`,
    text: [
      `Hi ${a.contact_name},`,
      `Your ${t.name} with ${firm} is booked for ${whenFor(a)}.`,
      t.location ? `Where: ${t.location}` : "",
      `Need to change it? Cancel or pick another time here: ${manageUrl}`,
      firm,
    ].filter(Boolean).join("\n\n"),
  };
}

export function reminderEmail(a: Appointment, t: AppointmentType, firm: string, manageUrl: string): { subject: string; text: string } {
  return {
    subject: `Reminder: ${t.name} on ${when(a.starts_at, a.client_time_zone ?? a.office_time_zone)}`,
    text: [
      `Hi ${a.contact_name},`,
      `This is a reminder of your ${t.name} with ${firm}: ${whenFor(a)}.`,
      t.location ? `Where: ${t.location}` : "",
      `Can't make it? Cancel or reschedule here: ${manageUrl}`,
      firm,
    ].filter(Boolean).join("\n\n"),
  };
}

export function reminderSms(a: Appointment, t: AppointmentType, firm: string, manageUrl: string): string {
  return `${firm}: reminder of your ${t.name} on ${when(a.starts_at, a.client_time_zone ?? a.office_time_zone)}. Change it: ${manageUrl} Reply STOP to opt out.`;
}

export function cancelledEmail(a: Appointment, t: AppointmentType, firm: string): { subject: string; text: string } {
  return { subject: `Cancelled: ${t.name} with ${firm}`, text: `Hi ${a.contact_name},\n\nYour ${t.name} on ${whenFor(a)} has been cancelled.\n\n${firm}` };
}

const icsText = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icsDate = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** A calendar file (.ics) for one appointment, so clients can add it to their own calendar. */
export function appointmentIcs(a: Appointment, t: AppointmentType, firm: string, host: string): string {
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Verexa HQ//Calendar//EN", "METHOD:PUBLISH", "BEGIN:VEVENT",
    `UID:${a.id}@${host}`, `DTSTAMP:${icsDate(a.updated_at)}`, `DTSTART:${icsDate(a.starts_at)}`, `DTEND:${icsDate(a.ends_at)}`,
    `SUMMARY:${icsText(`${t.name} with ${firm}`)}`,
    ...(t.location ? [`LOCATION:${icsText(t.location)}`] : []),
    ...(t.description ? [`DESCRIPTION:${icsText(t.description)}`] : []),
    `STATUS:${a.status === "cancelled" ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n") + "\r\n";
}

type Custom = { reminder_subject?: string | null; reminder_body?: string | null; reminder_sms?: string | null; cancel_subject?: string | null; cancel_body?: string | null } | null;

/** The reminder email and text: the office's own wording where it has written some, else the built-in one. */
export function reminderFrom(a: Appointment, t: AppointmentType, firm: string, manageUrl: string, custom: Custom): ConfirmationSet {
  const v = valuesFor(a, t, firm, manageUrl, whenFor(a));
  return {
    subject: fillMessage(custom?.reminder_subject || DEFAULT_REMINDER_SUBJECT, v),
    text: fillMessage(custom?.reminder_body || DEFAULT_REMINDER_BODY, v),
    sms: fillMessage(custom?.reminder_sms || DEFAULT_REMINDER_SMS, v),
  };
}

/** The email a client gets when an appointment is cancelled. */
export function cancellationFrom(a: Appointment, t: AppointmentType, firm: string, custom: Custom): { subject: string; text: string } {
  const v = valuesFor(a, t, firm, "", whenFor(a));
  return { subject: fillMessage(custom?.cancel_subject || DEFAULT_CANCEL_SUBJECT, v), text: fillMessage(custom?.cancel_body || DEFAULT_CANCEL_BODY, v) };
}
