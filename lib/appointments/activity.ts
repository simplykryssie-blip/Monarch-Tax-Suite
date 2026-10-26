import { KINDS, type NewNotification } from "../notifications/types.ts";
import { when } from "./messages.ts";
import type { Appointment, AppointmentType } from "./types.ts";

/** Something happened to an appointment, for the bell. `by` says who did it: the client from their link, or someone in the office. */
export type AppointmentActivity = {
  kind: "booked" | "rescheduled" | "cancelled";
  appointment: Appointment;
  type: AppointmentType;
  by: "client" | "staff";
  /** The staff member who did it, so they are not told about their own action. */
  actorId?: string | null;
  /** For a reschedule: the time it moved from. */
  from?: string;
};

const day = (iso: string, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

/** The wording and link for one appointment event. */
export function appointmentNotice(e: AppointmentActivity): NewNotification {
  const a = e.appointment, tz = a.office_time_zone;
  const verb = e.kind === "booked" ? "booked" : e.kind === "rescheduled" ? "moved" : "cancelled";
  const who = e.by === "client" ? a.contact_name : `${a.contact_name}'s`;
  const title = e.by === "client" ? `${who} ${verb} ${e.type.name}` : `${e.type.name} ${e.kind === "booked" ? "booked for" : e.kind === "rescheduled" ? "moved for" : "cancelled for"} ${a.contact_name}`;
  const detail = e.kind === "rescheduled" && e.from ? `${when(e.from, tz)} → ${when(a.starts_at, tz)}`
    : e.kind === "cancelled" ? `${when(a.starts_at, tz)}${a.cancel_reason ? ` · ${a.cancel_reason}` : ""}`
    : when(a.starts_at, tz);
  return {
    kind: e.kind === "booked" ? KINDS.appointmentBooked : e.kind === "rescheduled" ? KINDS.appointmentRescheduled : KINDS.appointmentCancelled,
    title, detail, href: `/calendar?view=day&date=${day(a.starts_at, tz)}`,
    clientId: a.client_id, actorId: e.by === "staff" ? e.actorId ?? null : null,
    dedupeKey: `appointment:${e.kind}:${a.id}:${a.updated_at}`,
  };
}
