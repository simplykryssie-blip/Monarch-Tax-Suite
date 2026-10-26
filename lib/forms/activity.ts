import { KINDS, type NewNotification } from "../notifications/types.ts";

/** The bell's wording for a form that was filled in. */
export function formSubmittedNotice(form: { id: string; name: string }, s: { id: string; respondent_name: string | null; respondent_email: string | null; client_id?: string | null }): NewNotification {
  const who = s.respondent_name || s.respondent_email || "Someone";
  // Through a client's personal link: it is that client's completed form, and their files have the PDF.
  if (s.client_id) return { kind: KINDS.formSubmitted, title: `${who} completed ${form.name}`, href: `/workspace/clients/${s.client_id}?tab=documents`, clientId: s.client_id, dedupeKey: `form:submitted:${s.id}` };
  return { kind: KINDS.formSubmitted, title: `${who} submitted ${form.name}`, href: `/forms/${form.id}/submissions/${s.id}`, dedupeKey: `form:submitted:${s.id}` };
}

/** A client opened the form that was sent to them. */
export function formOpenedNotice(form: { id: string; name: string }, clientName: string, clientId: string): NewNotification {
  return { kind: KINDS.formOpened, title: `${clientName} opened ${form.name}`, href: `/workspace/clients/${clientId}?tab=documents`, clientId, dedupeKey: `form:opened:${form.id}:${clientId}:${new Date().toISOString().slice(0, 10)}` };
}
