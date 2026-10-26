"use server";

import { redirect } from "next/navigation";
import { bookingContext, bookingVisitor } from "@/lib/appointments/public";
import { bookingProblems, wantsTexts, type BookingProblems } from "@/lib/appointments/booking-form.ts";
import { bookPublic, cancelByToken, rescheduleByToken } from "@/lib/appointments/service.ts";
import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { ValidationError } from "@/lib/commerce/validation.ts";

// Public booking actions. The web address the page was opened on names the office; every action is limited per
// visitor, and a link's token is the only credential for changing a booking.

const str = (form: FormData, k: string, max = 400) => (typeof form.get(k) === "string" ? (form.get(k) as string).slice(0, max) : "");
const back = (path: string, error: string) => `${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(error)}`;
const message = (e: unknown) => {
  if (e instanceof ValidationError) return e.message;
  console.error(`public booking failed: ${sanitizeError(e, 200)}`);
  return "Something went wrong on our side. Nothing was booked; please try again in a minute.";
};

export type BookResult = { error?: string; problems?: BookingProblems };

/** Books from the public page. A problem comes back as a result, so the page keeps everything the visitor typed and marks what to fix. */
export async function bookFormAction(slug: string, _previous: BookResult, form: FormData): Promise<BookResult> {
  let target: string;
  try {
    // A field real visitors never see: bots that fill every field are quietly turned away.
    if (str(form, "website")) throw new ValidationError("Something went wrong. Please try again.");
    const name = str(form, "name", 200), email = str(form, "email", 254), phone = str(form, "phone", 40), startsAt = str(form, "starts_at", 40);
    const problems = bookingProblems({ name, email, phone, starts_at: startsAt });
    if (Object.keys(problems).length) return { error: "A few things need your attention.", problems };
    const { tenantId, deps } = await bookingContext();
    await bookingVisitor(tenantId, "book");
    const { token } = await bookPublic(deps, slug, {
      name, email, phone, notes: str(form, "notes", 1000), starts_at: startsAt, time_zone: str(form, "time_zone", 64), sms_consent: wantsTexts(form.get("sms_consent") === "on", phone),
    });
    target = `/book/manage/${token}?booked=1`;
  } catch (e) {
    return { error: message(e) };
  }
  redirect(target);
}

export async function cancelAction(token: string, form: FormData) {
  const path = `/book/manage/${encodeURIComponent(token)}`;
  let target: string;
  try {
    const { tenantId, deps } = await bookingContext();
    await bookingVisitor(tenantId, "change");
    await cancelByToken(deps, token, str(form, "reason", 300));
    target = `${path}?cancelled=1`;
  } catch (e) {
    target = back(path, message(e));
  }
  redirect(target);
}

export async function rescheduleAction(token: string, form: FormData) {
  const path = `/book/manage/${encodeURIComponent(token)}`;
  let target: string;
  try {
    const { tenantId, deps } = await bookingContext();
    await bookingVisitor(tenantId, "change");
    await rescheduleByToken(deps, token, str(form, "starts_at", 40));
    target = `${path}?moved=1`;
  } catch (e) {
    target = back(path, message(e));
  }
  redirect(target);
}
