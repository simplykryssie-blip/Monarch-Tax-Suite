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
