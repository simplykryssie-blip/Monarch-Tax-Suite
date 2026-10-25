import { KINDS, type NewNotification } from "../notifications/types.ts";

/** The bell's wording for a form that was filled in. */
export function formSubmittedNotice(form: { id: string; name: string }, s: { id: string; respondent_name: string | null; respondent_email: string | null }): NewNotification {
  const who = s.respondent_name || s.respondent_email || "Someone";
  return { kind: KINDS.formSubmitted, title: `${who} submitted ${form.name}`, href: `/forms/${form.id}/submissions/${s.id}`, dedupeKey: `form:submitted:${s.id}` };
}
