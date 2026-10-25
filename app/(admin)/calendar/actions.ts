"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { appointmentDeps } from "@/lib/appointments/server";
import {
  addDateOverride, bookByStaff, cancelByStaff, createType, editType, markOutcome, officeLocalToIso, rescheduleByStaff, saveBookingMessages, saveWeekly,
} from "@/lib/appointments/service.ts";

// Every action re-checks administrator access and acts for the signed-in tenant only.

const str = (form: FormData, k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string) : "");
const withParam = (path: string, key: "notice" | "error", message: string) => `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(message)}`;

async function act(back: string, fn: (adminId: string) => Promise<string>, then?: string) {
  const admin = await requireAdmin();
  let target: string;
  try {
    const message = await fn(admin.userId);
    target = withParam(then ?? back, "notice", message);
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

export async function bookAction(form: FormData) {
  await act("/calendar/new", async (adminId) => {
    const tz = await timeZone();
    await bookByStaff(office(), adminId, {
      type_id: str(form, "type_id"), starts_at: officeLocalToIso(str(form, "starts_at"), tz), name: str(form, "name"), email: str(form, "email"),
      phone: str(form, "phone"), notes: str(form, "notes"), sms_consent: form.get("sms_consent") === "on", client_id: str(form, "client_id"),
    });
    return "Appointment booked.";
  }, "/calendar");
}

export async function cancelAction(form: FormData) {
  await act("/calendar", async () => {
    await cancelByStaff(office(), str(form, "id"), str(form, "reason"), form.get("notify") === "on");
    return "Appointment cancelled.";
  });
}

export async function moveAction(form: FormData) {
  await act("/calendar", async () => {
    await rescheduleByStaff(office(), str(form, "id"), officeLocalToIso(str(form, "starts_at"), await timeZone()));
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
  await act("/calendar/types", async (adminId) => {
    const reset = str(form, "reset") === "yes";
    await saveBookingMessages(office(), reset ? {} : Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")), adminId);
    return reset ? "Back to the standard wording." : "Messages saved.";
  });
}

export async function saveTypeAction(form: FormData) {
  await act("/calendar/types", async (adminId) => {
    const raw: Record<string, unknown> = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string"));
    raw.assignee_id = raw.assignee === "me" ? adminId : "";
    raw.active = form.get("active") === "on";
    const id = str(form, "id");
    if (id) { await editType(office(), id, raw); return "Appointment type saved."; }
    await createType(office(), raw);
    return "Appointment type added.";
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
  await act(`/settings/availability?who=${who}`, async (adminId) => {
    await saveWeekly(office(), who === "me" ? adminId : null, weeklyFrom(form));
    return "Weekly hours saved.";
  });
}

export async function addOverrideAction(form: FormData) {
  const who = str(form, "who") === "me" ? "me" : "office";
  await act(`/settings/availability?who=${who}`, async (adminId) => {
    await addDateOverride(office(), who === "me" ? adminId : null, { date: str(form, "date"), closed: form.get("closed") === "on", from: str(form, "from"), to: str(form, "to") });
    return "Date saved.";
  });
}

export async function removeOverrideAction(form: FormData) {
  const who = str(form, "who") === "me" ? "me" : "office";
  await act(`/settings/availability?who=${who}`, async () => {
    await office().repo.removeRule(str(form, "id"));
    return "Date removed.";
  });
}
