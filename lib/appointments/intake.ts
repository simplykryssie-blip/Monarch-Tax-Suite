import type { Appointment, AppointmentType } from "./types.ts";

/** One filled-in form: who it came from and when. */
export type IntakeSubmission = { form_id: string; respondent_email: string | null; submitted_at: string | null };

/** Whether each appointment whose type asks for a form has had it filled in by that email address since booking. Appointments with no form are left out. */
export function intakeStatus(appointments: Appointment[], types: AppointmentType[], submissions: IntakeSubmission[]): Map<string, "done" | "waiting"> {
  const formOf = new Map(types.map((t) => [t.id, t.intake_form_id]));
  const out = new Map<string, "done" | "waiting">();
  for (const a of appointments) {
    const form = formOf.get(a.type_id);
    if (!form) continue;
    const email = a.contact_email.toLowerCase();
    const done = submissions.some((s) => s.form_id === form && s.respondent_email?.toLowerCase() === email && s.submitted_at !== null && Date.parse(s.submitted_at) >= Date.parse(a.created_at) - 60_000);
    out.set(a.id, done ? "done" : "waiting");
  }
  return out;
}
