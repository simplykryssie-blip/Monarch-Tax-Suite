"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { appointmentDeps } from "@/lib/appointments/server";
import { createLead } from "@/lib/leads/service.ts";
import { leadsDeps } from "@/lib/leads/server";
import { workspaceRepo } from "@/lib/workspace/server";
import {
  addDateOverride, bookByStaff, cancelByStaff, createType, editType, markOutcome, setTypeArchived, sendTestMessage, officeLocalToIso, rescheduleByStaff, resendConfirmation, saveBookingMessages, saveWeekly, type ConfirmationOutcome,
} from "@/lib/appointments/service.ts";

// Every action re-checks administrator access and acts for the signed-in tenant only.

const str = (form: FormData, k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string) : "");
const withParam = (path: string, key: "notice" | "error", message: string) => `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(message)}`;

async function act(back: string, fn: (adminId: string) => Promise<string>, then?: string) {
  const admin = await requireAdmin();
  let target: string;
  try {
    const message = await fn(admin.userId);
    // A message starting with "!" is a warning: shown in red, but the page still moves on (the work was saved).
    target = message.startsWith("!") ? withParam(then ?? back, "error", message.slice(1)) : withParam(then ?? back, "notice", message);
  } catch (e) {
    if (e instanceof ValidationError) target = withParam(back, "error", e.message);
    else {
      const msg = e instanceof Error ? e.message : "";
      console.error(`calendar action failed: ${sanitizeError(e, 200)}`);
      target = withParam(back, "error", /relation|schema cache|does not exist/i.test(msg) ? "The calendar isn't installed yet. Apply the calendar migration first." : "That did not work. Nothing was changed. Please try again.");
    }
  }
  revalidatePath("/calendar", "layout");
  redirect(target);
}

const office = () => appointmentDeps();
const timeZone = async () => (await office().calendar()).timeZone;

export type PersonHit = { kind: "client" | "lead"; id: string; name: string; email: string | null; phone: string | null };

/** Names matching what is being typed, from clients and leads, for the New appointment form. */
export async function searchPeopleAction(q: string): Promise<PersonHit[]> {
  await requireAdmin();
  const term = typeof q === "string" ? q.trim().slice(0, 80) : "";
  if (term.length < 2) return [];
  const [clients, leads] = await Promise.all([
    workspaceRepo().listClients({ q: term, includeArchived: false }).catch(() => []),
    leadsDeps().repo.listLeads({ q: term, limit: 8 }).catch(() => []),
  ]);
  return [
    ...clients.slice(0, 8).map((c): PersonHit => ({ kind: "client", id: c.id, name: c.full_name, email: c.email, phone: c.phone })),
    ...leads.slice(0, 8).map((l): PersonHit => ({ kind: "lead", id: l.id, name: l.full_name, email: l.email, phone: l.phone })),
  ].slice(0, 8);
}

/** Adds a lead from the New appointment form and hands its details back so the form can fill itself in. */
export async function addLeadFromCalendarAction(input: { name: string; email: string; phone: string }): Promise<{ ok: true; person: PersonHit } | { ok: false; error: string }> {
  const admin = await requireAdmin();
  try {
    const lead = await createLead(leadsDeps(), { full_name: input.name, email: input.email, phone: input.phone, source: "calendar", status: "new" }, admin.userId);
    return { ok: true, person: { kind: "lead", id: lead.id, name: lead.full_name, email: lead.email, phone: lead.phone } };
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    if (e instanceof Error && /already a lead/.test(e.message)) return { ok: false, error: e.message };
    console.error(`calendar add lead failed: ${sanitizeError(e, 200)}`);
    return { ok: false, error: "That did not work. Nothing was added. Please try again." };
  }
}

/** Plain words for how the confirmation went, so a failure is never silent. */
function confirmationNotice(c: ConfirmationOutcome, who: string): string {
  const parts: string[] = [];
  parts.push(c.email.ok ? `a confirmation email was sent to ${who}` : `the confirmation email to ${who} could NOT be sent (${c.email.message ?? "unknown reason"}) — use Resend confirmation or let them know yourself`);
  if (c.sms) parts.push(c.sms.ok ? "a text was sent" : `the text could NOT be sent (${c.sms.message ?? "unknown reason"})`);
  const text = parts.join("; ");
  return text.charAt(0).toUpperCase() + text.slice(1) + ".";
}

export async function bookAction(form: FormData) {
  await act("/calendar/new", async (adminId) => {
    const tz = await timeZone();
    const booked = await bookByStaff(office(), adminId, {
      type_id: str(form, "type_id"), starts_at: officeLocalToIso(str(form, "starts_at"), tz), name: str(form, "name"), email: str(form, "email"),
      phone: str(form, "phone"), notes: str(form, "notes"), sms_consent: form.get("sms_consent") === "on", client_id: str(form, "client_id"),
    });
    const c = booked.confirmation;
    const sent = c.email.ok && (c.sms === null || c.sms.ok);
    // A failed confirmation goes out as an error so it is shown in red, but the booking itself stands.
    return `${sent ? "" : "!"}Appointment booked. ${confirmationNotice(c, booked.appointment.contact_email)}${sent ? "" : " The appointment is saved."}`;
  }, "/calendar");
}

export async function resendConfirmationAction(form: FormData) {
  await act("/calendar", async () => {
    const a = await resendConfirmation(office(), str(form, "id"));
    return `${a.email.ok && (a.sms === null || a.sms.ok) ? "" : "!"}${confirmationNotice(a, "the client")}`;
  });
}

export async function cancelAction(form: FormData) {
  await act("/calendar", async (adminId) => {
    await cancelByStaff(office(), str(form, "id"), str(form, "reason"), form.get("notify") === "on", adminId);
    return "Appointment cancelled.";
  });
}

export async function moveAction(form: FormData) {
  await act("/calendar", async (adminId) => {
    await rescheduleByStaff(office(), str(form, "id"), officeLocalToIso(str(form, "starts_at"), await timeZone()), adminId);
    return "Appointment moved.";
  });
}

export async function outcomeAction(form: FormData) {
  await act("/calendar", async () => {
    await markOutcome(office(), str(form, "id"), str(form, "outcome"));
    return "Appointment updated.";
  });
}

export async function saveBookingMessagesAction(form: FormData) {
  await act("/settings/calendar", async (adminId) => {
    const reset = str(form, "reset") === "yes";
    await saveBookingMessages(office(), reset ? { group: str(form, "group") } : Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")), adminId);
    return reset ? "Back to the standard wording." : "Messages saved.";
  });
}

export async function sendTestMessageAction(form: FormData) {
  const admin = await requireAdmin();
  await act("/settings/calendar", async () => sendTestMessage(office(), Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")), admin.email));
}

export async function saveTypeAction(form: FormData) {
  await act("/settings/calendar", async (adminId) => {
    const raw: Record<string, unknown> = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string"));
    raw.assignee_id = raw.assignee === "me" ? adminId : "";
    raw.active = form.get("active") === "on";
    const id = str(form, "id");
    if (id) { await editType(office(), id, raw); return "Appointment type saved."; }
    await createType(office(), raw);
    return "Appointment type added.";
  });
}

export async function archiveTypeAction(form: FormData) {
  await act("/settings/calendar", async () => {
    const restore = str(form, "restore") === "yes";
    await setTypeArchived(office(), str(form, "id"), !restore);
    return restore ? "Appointment type restored. It is open for booking again." : "Appointment type archived. It no longer takes bookings; past appointments are kept.";
  });
}

function weeklyFrom(form: FormData): Record<number, [string, string][]> {
  const out: Record<number, [string, string][]> = {};
  for (let d = 0; d < 7; d++) {
    if (form.get(`open_${d}`) !== "on") continue;
    const spans: [string, string][] = [];
    for (const n of [1, 2]) {
      const a = str(form, `from${n}_${d}`), b = str(form, `to${n}_${d}`);
      if (a || b) spans.push([a, b]);
    }
    out[d] = spans;
  }
  return out;
}

export async function saveWeeklyAction(form: FormData) {
  const who = str(form, "who") === "me" ? "me" : "office";
  await act(`/settings/calendar?who=${who}`, async (adminId) => {
    await saveWeekly(office(), who === "me" ? adminId : null, weeklyFrom(form));
    return "Weekly hours saved.";
  });
}

export async function addOverrideAction(form: FormData) {
  const who = str(form, "who") === "me" ? "me" : "office";
  await act(`/settings/calendar?who=${who}`, async (adminId) => {
    await addDateOverride(office(), who === "me" ? adminId : null, { date: str(form, "date"), closed: form.get("closed") === "on", from: str(form, "from"), to: str(form, "to") });
    return "Date saved.";
  });
}

export async function removeOverrideAction(form: FormData) {
  const who = str(form, "who") === "me" ? "me" : "office";
  await act(`/settings/calendar?who=${who}`, async () => {
    await office().repo.removeRule(str(form, "id"));
    return "Date removed.";
  });
}
