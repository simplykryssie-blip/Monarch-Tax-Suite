import { ValidationError } from "../commerce/validation.ts";
import { checkEmail, checkName, checkPhone } from "../leads/service.ts";

/** What is wrong with the details typed on the public booking page, field by field, so the page can mark each one and keep everything typed. */
export type BookingProblems = Partial<Record<"name" | "email" | "phone" | "starts_at", string>>;

export function bookingProblems(raw: { name: string; email: string; phone: string; starts_at: string }): BookingProblems {
  const out: BookingProblems = {};
  const check = (key: keyof BookingProblems, fn: () => unknown) => {
    try { fn(); } catch (e) { out[key] = e instanceof ValidationError ? e.message : "Check this one."; }
  };
  check("name", () => checkName(raw.name));
  check("email", () => checkEmail(raw.email));
  if (raw.phone.trim()) check("phone", () => checkPhone(raw.phone));
  if (!raw.starts_at.trim()) out.starts_at = "Pick a day and a time.";
  return out;
}

/**
 * Text reminders are asked for with the box ticked from the start. They only apply with a mobile number: with no number
 * the box is left out quietly rather than stopping the booking.
 */
export const wantsTexts = (ticked: boolean, phone: string) => ticked && phone.trim().length > 0;
