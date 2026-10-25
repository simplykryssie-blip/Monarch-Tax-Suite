import { intakeStatus } from "../lib/appointments/intake.ts";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import test from "node:test";
import { DEFAULT_WEEK } from "../lib/calendar/business.ts";
import { ValidationError } from "../lib/commerce/validation.ts";
import { appointmentIcs, reminderSms, whenFor } from "../lib/appointments/messages.ts";
import {
  addDateOverride, bookByStaff, bookPublic, saveBookingMessages, cancelByStaff, cancelByToken, checkType, createType, editType, listSlots, lookupByToken, markOutcome,
  rescheduleByStaff, rescheduleByToken, saveWeekly, sendDueReminders, slugOf, type AppointmentDeps,
} from "../lib/appointments/service.ts";
import type { Busy } from "../lib/appointments/slots.ts";
import { OverlapError, type Appointment, type AppointmentRepo, type AppointmentType, type BookingMessages, type NewAppointment, type NewReminder, type Notifier, type ReminderRow, type RuleRow, type TypeInput } from "../lib/appointments/types.ts";
import type { Lead, LeadsRepo } from "../lib/leads/types.ts";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-12T00:00:00Z"); // Sunday evening in New York

class Memory implements AppointmentRepo {
  messages: BookingMessages | null = null;
  async getMessages() { return this.messages; }
  async saveMessages(m: BookingMessages) { this.messages = m; }
  types: AppointmentType[] = [];
  rules: RuleRow[] = [];
  appts: Appointment[] = [];
  reminders: ReminderRow[] = [];
  async listTypes() { return this.types; }
  async getType(id: string) { return this.types.find((t) => t.id === id) ?? null; }
  async getTypeBySlug(slug: string) { return this.types.find((t) => t.slug === slug) ?? null; }
  async insertType(i: TypeInput) { const t = { ...i, id: randomUUID(), tenant_id: TENANT, created_at: "", updated_at: "" }; this.types.push(t); return t; }
  async updateType(id: string, p: Partial<TypeInput>) { const t = this.types.find((x) => x.id === id)!; Object.assign(t, p); return t; }
  async listRules(a: string | null) { return this.rules.filter((r) => r.assignee_id === a); }
  async replaceWeekly(a: string | null, rows: { weekday: number; start_time: string; end_time: string }[]) {
    this.rules = this.rules.filter((r) => !(r.assignee_id === a && r.weekday !== null));
    for (const r of rows) this.rules.push({ id: randomUUID(), assignee_id: a, on_date: null, closed: false, ...r });
  }
  async addDateRule(a: string | null, row: { on_date: string; closed: boolean; start_time: string | null; end_time: string | null }) { this.rules.push({ id: randomUUID(), assignee_id: a, weekday: null, ...row }); }
  async removeRule(id: string) { this.rules = this.rules.filter((r) => r.id !== id); }
  async listBusy(a: string | null, from: Date, to: Date, except?: string): Promise<Busy[]> {
    return this.appts.filter((x) => x.status === "booked" && x.assignee_id === a && x.id !== except && new Date(x.block_start) < to && new Date(x.block_end) > from).map((x) => ({ start: new Date(x.block_start), end: new Date(x.block_end) }));
  }
  private clash(x: Pick<Appointment, "id" | "assignee_id" | "block_start" | "block_end">) {
    return this.appts.some((o) => o.id !== x.id && o.status === "booked" && o.assignee_id === x.assignee_id && o.block_start < x.block_end && x.block_start < o.block_end);
  }
  async insertAppointment(r: NewAppointment) {
    if (this.clash(r)) throw new OverlapError("overlap");
    const a = { ...r, tenant_id: TENANT, created_at: NOW.toISOString(), updated_at: NOW.toISOString() } as Appointment; this.appts.push(a); return a;
  }
  async getAppointment(id: string) { return this.appts.find((a) => a.id === id) ?? null; }
  async getByTokenHash(h: string) { return this.appts.find((a) => a.manage_token_hash === h) ?? null; }
  async updateAppointment(id: string, p: Partial<Appointment>) {
    const a = this.appts.find((x) => x.id === id)!;
    const next = { ...a, ...p };
    if (next.status === "booked" && this.clash(next)) throw new OverlapError("overlap");
    Object.assign(a, p); return a;
  }
  async listAppointments() { return this.appts; }
  async listForContact(e: string) { return this.appts.filter((a) => a.contact_email === e); }
  async insertReminders(rows: NewReminder[]) { for (const r of rows) this.reminders.push({ id: randomUUID(), tenant_id: TENANT, status: "pending", sent_at: null, detail: null, ...r }); }
  async cancelPendingReminders(id: string) { for (const r of this.reminders) if (r.appointment_id === id && r.status === "pending") r.status = "skipped"; }
  async dueReminders(now: Date, limit: number) { return this.reminders.filter((r) => r.status === "pending" && new Date(r.send_at) <= now).slice(0, limit); }
  async claimReminder(id: string, now: Date) { const r = this.reminders.find((x) => x.id === id)!; if (r.status !== "pending") return false; r.status = "sent"; r.sent_at = now.toISOString(); return true; }
  async markReminder(id: string, s: "sent" | "failed" | "skipped", detail: string | null) { const r = this.reminders.find((x) => x.id === id)!; r.status = s; r.detail = detail; }
}

function make(clock = { t: NOW }) {
  const repo = new Memory();
  const sent: { channel: "email" | "sms"; to: string; body: string }[] = [];
  const events: string[] = [];
  const leads: Lead[] = [];
  const leadEvents: string[] = [];
  const leadsRepo = {
    async findByEmail(e: string) { return leads.find((l) => l.email === e) ?? null; },
    async updateLead(id: string, p: Partial<Lead>) { const l = leads.find((x) => x.id === id)!; Object.assign(l, p); return l; },
    async insertLead(i: Omit<Lead, "id">) { const l = { ...i, id: randomUUID() } as Lead; leads.push(l); return l; },
    async addEvent(e: { action: string }) { leadEvents.push(e.action); },
  } as unknown as LeadsRepo;
  const notify: Notifier = {
    async email(to, subject, text) { sent.push({ channel: "email", to, body: `${subject}\n${text}` }); return { ok: true }; },
    async sms(to, body) { sent.push({ channel: "sms", to, body }); return { ok: true }; },
  };
  const deps: AppointmentDeps = {
    tenantId: TENANT, repo, notify, now: () => clock.t,
    calendar: async () => ({ timeZone: "America/New_York", week: DEFAULT_WEEK, closures: [] }),
    people: { people: { async findCustomers() { return []; }, async findClients() { return []; }, async fillClientPhone() {} }, leads: leadsRepo },
    firmName: async () => "Acme Tax",
    tokenFor: (id) => createHmac("sha256", "test-secret").update(`${TENANT}:${id}`).digest("hex"),
    manageUrl: async (t) => `https://book.example.com/book/manage/${t}`,
    emit: async (type) => { events.push(type); },
  };
  return { repo, deps, sent, events, leads, leadEvents, clock };
}
const TYPE = { name: "Tax Prep Consultation", duration_minutes: 30, step_minutes: 30, min_notice_minutes: 60, buffer_after_minutes: 15 };
const MON_10AM = "2026-10-12T14:00:00.000Z"; // 10:00 New York
const person = { name: "Ana Ruiz", email: "Ana@Example.com", phone: "(337) 555-0100", sms_consent: "on", time_zone: "America/Chicago" };

test("a type's link name comes from its name, and clashes are refused", async () => {
  const { deps } = make();
  assert.equal(slugOf("Tax Prep: 30-min Consult!"), "tax-prep-30-min-consult");
  const t = await createType(deps, TYPE);
  assert.equal(t.slug, "tax-prep-consultation");
  await assert.rejects(createType(deps, TYPE), /already uses that link name/);
  assert.throws(() => checkType({ name: "X", duration_minutes: 2 }), /Length/);
  assert.throws(() => checkType({ name: "X", reminder_hours: "24, 2, 1, 5" }), /up to three/);
  assert.deepEqual(checkType({ name: "X", reminder_hours: "24, 2, 24" }).reminder_hours, [24, 2]);
  const edited = await editType(deps, t.id, { ...TYPE, name: "Renamed", slug: t.slug, active: "on" });
  assert.equal(edited.name, "Renamed");
});

test("the public page offers business-hours slots and a booking takes one", async () => {
  const { deps, repo, events, leads, sent } = make();
  const t = await createType(deps, TYPE);
  const before = await listSlots(deps, t, "2026-10-12", 1);
  assert.ok(before.some((s) => s.start.toISOString() === MON_10AM));
  const { appointment, token } = await bookPublic(deps, t.slug, { ...person, starts_at: MON_10AM });
  assert.equal(appointment.contact_email, "ana@example.com");
  assert.equal(appointment.client_time_zone, "America/Chicago");
  assert.equal(appointment.block_end, "2026-10-12T14:45:00.000Z", "buffer after is blocked");
  assert.ok(appointment.sms_consent && appointment.sms_consent_at);
  assert.equal(leads.length, 1, "a new person becomes a lead");
  assert.deepEqual(leads[0].tags, ["booked"]);
  assert.ok(events.includes("appointment.booked"));
  assert.equal(sent.filter((m) => m.channel === "email").length, 1, "confirmation sent");
  assert.match(sent[0].body, /book\/manage\//);
  const after = await listSlots(deps, t, "2026-10-12", 1);
  assert.ok(!after.some((s) => s.start.toISOString() === MON_10AM));
  assert.ok(!after.some((s) => s.start.toISOString() === "2026-10-12T14:30:00.000Z"), "buffer blocks the next slot too");
  assert.equal(repo.appts.length, 1);
  assert.equal((await lookupByToken(deps, token))?.a.id, appointment.id);
  assert.equal(await lookupByToken(deps, "nope"), null);
});

test("the second person to pick a time is told it was taken", async () => {
  const { deps } = make();
  const t = await createType(deps, TYPE);
  await bookPublic(deps, t.slug, { ...person, starts_at: MON_10AM });
  await assert.rejects(bookPublic(deps, t.slug, { ...person, email: "b@example.com", starts_at: MON_10AM }), /no longer available|just taken/);
});

test("the database rule backs it up even when the slot check is skipped", async () => {
  const { deps } = make();
  const t = await createType(deps, TYPE);
  await bookByStaff(deps, "staff-1", { type_id: t.id, name: "A", email: "a@example.com", starts_at: MON_10AM });
  await assert.rejects(bookByStaff(deps, "staff-1", { type_id: t.id, name: "B", email: "b@example.com", starts_at: "2026-10-12T14:20:00.000Z" }), /just taken/);
});

test("invalid bookings are refused with plain messages", async () => {
  const { deps } = make();
  const t = await createType(deps, TYPE);
  await assert.rejects(bookPublic(deps, "missing", { ...person, starts_at: MON_10AM }), /isn't available/);
  await assert.rejects(bookPublic(deps, t.slug, { ...person, email: "bad", starts_at: MON_10AM }), /valid email/);
  await assert.rejects(bookPublic(deps, t.slug, { ...person, phone: "", starts_at: MON_10AM }), /mobile number/);
  await assert.rejects(bookPublic(deps, t.slug, { ...person, starts_at: "2026-10-12T14:07:00.000Z" }), /no longer available/);
  await assert.rejects(bookPublic(deps, t.slug, { ...person, starts_at: "2026-10-17T14:00:00.000Z" }), /no longer available/, "Saturday is closed");
  await assert.rejects(bookPublic(deps, t.slug, { ...person, starts_at: "tomorrow" }), /Choose a time/);
  await editType(deps, t.id, { ...TYPE, slug: t.slug, active: false });
  await assert.rejects(bookPublic(deps, t.slug, { ...person, starts_at: MON_10AM }), /isn't available/);
});

test("a known client is matched, not duplicated as a lead", async () => {
  const { deps, leads } = make();
  deps.people.people.findClients = async () => [{ id: "c1", phone: null }];
  const t = await createType(deps, TYPE);
  const { appointment } = await bookPublic(deps, t.slug, { ...person, starts_at: MON_10AM });
  assert.equal(appointment.client_id, "c1");
  assert.equal(leads.length, 0);
});

test("cancel by link frees the time, drops reminders and tells automations", async () => {
  const { deps, repo, events } = make();
  const t = await createType(deps, { ...TYPE, reminder_hours: "2" });
  const { appointment, token } = await bookPublic(deps, t.slug, { ...person, starts_at: MON_10AM });
  assert.equal(repo.reminders.filter((r) => r.status === "pending").length, 2, "an email and a text");
  await assert.rejects(cancelByToken(deps, "x".repeat(30), "no"), /isn't valid/);
  const cancelled = await cancelByToken(deps, token, "Plans changed");
  assert.equal(cancelled.status, "cancelled");
  assert.equal(repo.reminders.filter((r) => r.status === "pending").length, 0);
  assert.ok(events.includes("appointment.cancelled"));
  assert.ok((await listSlots(deps, t, "2026-10-12", 1)).some((s) => s.start.toISOString() === MON_10AM));
  await assert.rejects(cancelByToken(deps, token, ""), /cancelled/);
  assert.equal((await repo.getAppointment(appointment.id))!.cancel_reason, "Plans changed");
});

test("reschedule by link moves it to another offered time, and not onto a taken one", async () => {
  const { deps, repo, events } = make();
  const t = await createType(deps, TYPE);
  const mine = await bookPublic(deps, t.slug, { ...person, starts_at: MON_10AM });
  await bookPublic(deps, t.slug, { ...person, email: "b@example.com", starts_at: "2026-10-12T16:00:00.000Z" });
  await assert.rejects(rescheduleByToken(deps, mine.token, "2026-10-12T16:00:00.000Z"), /no longer available/);
  const moved = await rescheduleByToken(deps, mine.token, "2026-10-12T15:00:00.000Z");
  assert.equal(moved.starts_at, "2026-10-12T15:00:00.000Z");
  assert.ok(events.includes("appointment.rescheduled"));
  assert.equal(repo.reminders.filter((r) => r.status === "pending" && r.appointment_id === moved.id).length, 0, "no reminders left to schedule: the 24-hour mark is already past");
  // its own old slot is free again, and it can move within its own blocked time
  assert.ok(await rescheduleByToken(deps, mine.token, MON_10AM));
});

test("a started appointment can't be changed online", async () => {
  const { deps, clock } = make();
  const t = await createType(deps, TYPE);
  const { token } = await bookPublic(deps, t.slug, { ...person, starts_at: MON_10AM });
  clock.t = new Date("2026-10-12T14:05:00Z");
  await assert.rejects(cancelByToken(deps, token, ""), /already started/);
});

test("staff can book outside the offered hours, move, cancel and mark outcomes", async () => {
  const { deps, clock, events } = make();
  const t = await createType(deps, TYPE);
  const sat = "2026-10-17T15:00:00.000Z";
  const { appointment } = await bookByStaff(deps, "staff-1", { type_id: t.id, name: "Walk-in", email: "w@example.com", starts_at: sat, notes: "Brings W-2s" });
  assert.equal(appointment.source, "staff");
  assert.equal(appointment.created_by, "staff-1");
  const moved = await rescheduleByStaff(deps, appointment.id, "2026-10-17T16:00:00.000Z");
  assert.equal(moved.starts_at, "2026-10-17T16:00:00.000Z");
  await assert.rejects(markOutcome(deps, appointment.id, "done"), /hasn't started/);
  clock.t = new Date("2026-10-17T20:00:00Z");
  assert.equal((await markOutcome(deps, appointment.id, "no_show")).status, "no_show");
  assert.ok(events.includes("appointment.no_show"));
  await assert.rejects(markOutcome(deps, appointment.id, "done"), /Only a booked/);
  await assert.rejects(markOutcome(deps, appointment.id, "weird"), ValidationError);
  const other = await bookByStaff(deps, "staff-1", { type_id: t.id, name: "B", email: "b@example.com", starts_at: "2026-10-20T15:00:00.000Z" });
  assert.equal((await cancelByStaff(deps, other.appointment.id, "Office closed", true)).status, "cancelled");
});

test("availability: staff rules apply, date overrides add or remove days, bad input is refused", async () => {
  const { deps } = make();
  const t = await createType(deps, TYPE);
  await saveWeekly(deps, null, { 1: [["13:00", "15:00"]], 6: [["10:00", "12:00"]] });
  const slots = await listSlots(deps, t, "2026-10-12", 7);
  assert.deepEqual([...new Set(slots.map((s) => s.date))], ["2026-10-12", "2026-10-17"]);
  await addDateOverride(deps, null, { date: "2026-10-12", closed: "on" });
  assert.ok(!(await listSlots(deps, t, "2026-10-12", 1)).length);
  await addDateOverride(deps, null, { date: "2026-10-13", from: "08:00", to: "09:00" });
  assert.equal((await listSlots(deps, t, "2026-10-13", 1)).length, 2);
  await assert.rejects(saveWeekly(deps, null, { 1: [["15:00", "13:00"]] }), /end after/);
  await assert.rejects(saveWeekly(deps, null, { 1: [["09:00", "12:00"], ["11:00", "13:00"]] }), /overlap/);
  await assert.rejects(addDateOverride(deps, null, { date: "x" }), /Choose a date/);
  await assert.rejects(addDateOverride(deps, null, { date: "2026-10-14", from: "9am", to: "10:00" }), /time like/);
});

test("reminders: sent once each, text only with consent, skipped when the appointment is gone", async () => {
  const { deps, repo, sent, clock } = make();
  const t = await createType(deps, { ...TYPE, reminder_hours: "24, 2" });
  const a = await bookPublic(deps, t.slug, { ...person, starts_at: "2026-10-14T14:00:00.000Z" });
  const noText = await bookPublic(deps, t.slug, { name: "Ben", email: "ben@example.com", starts_at: "2026-10-14T16:00:00.000Z" });
  assert.equal(repo.reminders.length, 4 + 2, "two reminders each; a text only for the one with consent");
  sent.length = 0;
  clock.t = new Date("2026-10-13T15:00:00Z");
  const first = await sendDueReminders(deps);
  assert.deepEqual(first, { sent: 2, failed: 0, skipped: 0 });
  assert.equal(sent.filter((m) => m.channel === "sms").length, 1);
  assert.match(sent.find((m) => m.channel === "sms")!.body, /Reply STOP/);
  assert.equal((await sendDueReminders(deps)).sent, 0, "not twice");
  await cancelByToken(deps, noText.token, "");
  clock.t = new Date("2026-10-14T13:00:00Z");
  const second = await sendDueReminders(deps);
  assert.equal(second.sent, 2);
  void a;
});

test("a reminder that can't be sent is recorded as failed, not retried forever", async () => {
  const { deps, repo, clock } = make();
  deps.notify.email = async () => ({ ok: false, message: "provider down" });
  const t = await createType(deps, TYPE);
  await bookPublic(deps, t.slug, { name: "Ana", email: "a@example.com", starts_at: "2026-10-14T14:00:00.000Z" });
  clock.t = new Date("2026-10-13T15:00:00Z");
  assert.deepEqual(await sendDueReminders(deps), { sent: 0, failed: 1, skipped: 0 });
  assert.equal(repo.reminders[0].detail, "provider down");
  assert.equal((await sendDueReminders(deps)).failed, 0);
});

test("a failed confirmation email never fails the booking", async () => {
  const { deps, repo } = make();
  deps.notify.email = async () => { throw new Error("down"); };
  const t = await createType(deps, TYPE);
  await bookPublic(deps, t.slug, { ...person, starts_at: MON_10AM });
  assert.equal(repo.appts.length, 1);
});

test("an automation problem never fails a booking", async () => {
  const { deps, repo } = make();
  deps.emit = async () => { throw new Error("automation down"); };
  const t = await createType(deps, TYPE);
  await bookPublic(deps, t.slug, { ...person, starts_at: MON_10AM });
  assert.equal(repo.appts.length, 1);
});

test("messages show the client's time zone and the office's, and the calendar file is valid", async () => {
  const { deps } = make();
  const t = await createType(deps, { ...TYPE, location: "123 Main St; Suite 4", description: "Bring W-2s, 1099s" });
  const { appointment } = await bookPublic(deps, t.slug, { ...person, starts_at: MON_10AM });
  assert.match(whenFor(appointment), /Monday, October 12 at 9:00 AM CDT \(10:00 AM EDT at the office\)/);
  const ics = appointmentIcs(appointment, t, "Acme Tax", "example.com");
  assert.match(ics, /DTSTART:20261012T140000Z/);
  assert.match(ics, /DTEND:20261012T143000Z/);
  assert.match(ics, /LOCATION:123 Main St\; Suite 4/);
  assert.match(ics, /DESCRIPTION:Bring W-2s\\, 1099s/);
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.ok(reminderSms(appointment, t, "Acme Tax", "https://x.test/m").length < 320);
});

test("a booking sends the built-in confirmation email and text, or the wording the office wrote", async () => {
  const { deps, sent } = make();
  const t = await createType(deps, { ...TYPE, location: "12 Main St" });
  await bookPublic(deps, t.slug, { ...person, starts_at: MON_10AM });
  assert.match(sent[0].body, /^Confirmed: Tax Prep Consultation with Acme Tax\nHi Ana Ruiz,/);
  assert.match(sent[0].body, /Where: 12 Main St/);
  assert.equal(sent[1].channel, "sms", "a person who agreed to texts gets one");
  assert.match(sent[1].body, /^Acme Tax: your Tax Prep Consultation is booked for .*Reply STOP/);
  sent.length = 0;
  await saveBookingMessages(deps, { confirm_subject: "See you, {{first_name}}!", confirm_body: "{{office}} will see you {{date_time}} at {{location}}. {{nonsense}}Change: {{manage_link}}", confirm_sms: "Booked: {{date_time}}" }, null);
  await bookPublic(deps, t.slug, { ...person, email: "b@example.com", starts_at: "2026-10-12T15:00:00.000Z" });
  assert.match(sent[0].body, /^See you, Ana!\nAcme Tax will see you .* at 12 Main St\. Change: https:\/\/book\.example\.com\/book\/manage\//);
  assert.match(sent[1].body, /^Booked: /);
  // No consent, no text.
  sent.length = 0;
  await bookPublic(deps, t.slug, { ...person, email: "c@example.com", sms_consent: undefined, starts_at: "2026-10-12T16:00:00.000Z" });
  assert.deepEqual(sent.map((m) => m.channel), ["email"]);
  // Clearing a message goes back to the built-in wording; too-long ones are refused.
  await saveBookingMessages(deps, {}, null);
  sent.length = 0;
  await bookPublic(deps, t.slug, { ...person, email: "d@example.com", starts_at: "2026-10-12T17:00:00.000Z" });
  assert.match(sent[0].body, /^Confirmed: /);
  await assert.rejects(saveBookingMessages(deps, { confirm_sms: "x".repeat(321) }, null), /up to 320/);
});

test("every email carries the firm's name, address, phone and email at the bottom, and texts do not", async () => {
  const { deps, sent } = make();
  deps.firmSignature = async () => "Acme Tax\n12 Main St, Lake Charles, LA\n(337) 555-0100 · hello@acme.test";
  const t = await createType(deps, TYPE);
  await bookPublic(deps, t.slug, { ...person, starts_at: MON_10AM });
  assert.match(sent[0].body, /\n\n--\nAcme Tax\n12 Main St, Lake Charles, LA\n\(337\) 555-0100 · hello@acme\.test$/);
  assert.equal(sent[1].channel, "sms");
  assert.doesNotMatch(sent[1].body, /--\n/);
});

test("an appointment type can ask for a form: the confirmation links to it, and the calendar knows if it was filled in", async () => {
  const { deps, sent, repo } = make();
  const FORM = "11111111-1111-4111-8111-111111111111";
  deps.intakeLink = async (id) => (id === FORM ? "https://acme.test/f/AbCdEf1234567890" : null);
  assert.throws(() => checkType({ name: "X", intake_form_id: "nope" }), /Choose a form/);
  const t = await createType(deps, { ...TYPE, intake_form_id: FORM });
  assert.equal(t.intake_form_id, FORM);
  const { appointment } = await bookPublic(deps, t.slug, { ...person, starts_at: MON_10AM });
  assert.match(sent[0].body, /please fill in this form: https:\/\/acme\.test\/f\/AbCdEf1234567890/);
  const types = await repo.listTypes();
  const sub = (at: string) => ({ form_id: FORM, respondent_email: person.email.toUpperCase(), submitted_at: at });
  assert.equal(intakeStatus([appointment], types, []).get(appointment.id), "waiting");
  assert.equal(intakeStatus([appointment], types, [sub("2020-01-01T00:00:00Z")]).get(appointment.id), "waiting", "an older submission does not count");
  assert.equal(intakeStatus([appointment], types, [sub(new Date(Date.parse(appointment.created_at) + 1000).toISOString())]).get(appointment.id), "done");
  const plain = await createType(deps, { ...TYPE, name: "Plain", slug: "plain" });
  assert.equal(plain.intake_form_id, null);
});
