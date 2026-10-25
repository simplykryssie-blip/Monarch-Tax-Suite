import type { SupabaseClient } from "@supabase/supabase-js";
import type { Busy } from "./slots.ts";
import type { BookingMessages } from "./types.ts";
import { OverlapError, type Appointment, type AppointmentRepo, type AppointmentType, type NewAppointment, type NewReminder, type ReminderRow, type RuleRow, type TypeInput } from "./types.ts";

const fail = (what: string, e: { message: string }) => new Error(`${what}: ${e.message}`);
/** 23P01 is Postgres's "exclusion violation": another booking already holds this time. */
const overlap = (e: { code?: string }) => e.code === "23P01";

export class SupabaseAppointmentRepo implements AppointmentRepo {
  constructor(private db: SupabaseClient) {}

  async getMessages() {
    const { data, error } = await this.db.from("appointment_messages").select("confirm_subject, confirm_body, confirm_sms").maybeSingle();
    if (error) throw fail("messages failed", error);
    return (data as BookingMessages | null) ?? null;
  }
  async saveMessages(m: BookingMessages, actorId: string | null) {
    const { error } = await this.db.from("appointment_messages").upsert({ ...m, updated_by: actorId, updated_at: new Date().toISOString() }, { onConflict: "tenant_id" });
    if (error) throw fail("messages failed", error);
  }
  async listTypes() {
    const { data, error } = await this.db.from("appointment_types").select("*").order("name");
    if (error) throw fail("types failed", error);
    return (data ?? []) as AppointmentType[];
  }
  async getType(id: string) {
    const { data, error } = await this.db.from("appointment_types").select("*").eq("id", id).maybeSingle();
    if (error) throw fail("type lookup failed", error);
    return (data as AppointmentType | null) ?? null;
  }
  async getTypeBySlug(slug: string) {
    const { data, error } = await this.db.from("appointment_types").select("*").eq("slug", slug).maybeSingle();
    if (error) throw fail("type lookup failed", error);
    return (data as AppointmentType | null) ?? null;
  }
  async insertType(input: TypeInput) {
    const { data, error } = await this.db.from("appointment_types").insert(input).select("*").single();
    if (error) throw fail("type save failed", error);
    return data as AppointmentType;
  }
  async updateType(id: string, patch: Partial<TypeInput>) {
    const { data, error } = await this.db.from("appointment_types").update(patch).eq("id", id).select("*").single();
    if (error) throw fail("type save failed", error);
    return data as AppointmentType;
  }

  async listRules(assigneeId: string | null): Promise<RuleRow[]> {
    let q = this.db.from("availability_rules").select("id, assignee_id, weekday, on_date, closed, start_time, end_time");
    q = assigneeId ? q.eq("assignee_id", assigneeId) : q.is("assignee_id", null);
    const { data, error } = await q;
    if (error) throw fail("availability failed", error);
    return (data ?? []) as RuleRow[];
  }
  async replaceWeekly(assigneeId: string | null, rows: { weekday: number; start_time: string; end_time: string }[]) {
    let del = this.db.from("availability_rules").delete().not("weekday", "is", null);
    del = assigneeId ? del.eq("assignee_id", assigneeId) : del.is("assignee_id", null);
    const removed = await del;
    if (removed.error) throw fail("availability failed", removed.error);
    if (!rows.length) return;
    const { error } = await this.db.from("availability_rules").insert(rows.map((r) => ({ ...r, assignee_id: assigneeId, closed: false })));
    if (error) throw fail("availability failed", error);
  }
  async addDateRule(assigneeId: string | null, row: { on_date: string; closed: boolean; start_time: string | null; end_time: string | null }) {
    // One change per date: a new one replaces the old.
    let del = this.db.from("availability_rules").delete().eq("on_date", row.on_date);
    del = assigneeId ? del.eq("assignee_id", assigneeId) : del.is("assignee_id", null);
    const removed = await del;
    if (removed.error) throw fail("availability failed", removed.error);
    const { error } = await this.db.from("availability_rules").insert({ ...row, assignee_id: assigneeId });
    if (error) throw fail("availability failed", error);
  }
  async removeRule(id: string) {
    const { error } = await this.db.from("availability_rules").delete().eq("id", id);
    if (error) throw fail("availability failed", error);
  }

  async listBusy(assigneeId: string | null, from: Date, to: Date, exceptId?: string): Promise<Busy[]> {
    let q = this.db.from("appointments").select("block_start, block_end").eq("status", "booked").lt("block_start", to.toISOString()).gt("block_end", from.toISOString());
    q = assigneeId ? q.eq("assignee_id", assigneeId) : q.is("assignee_id", null);
    if (exceptId) q = q.neq("id", exceptId);
    const { data, error } = await q.limit(2000);
    if (error) throw fail("bookings failed", error);
    return ((data ?? []) as { block_start: string; block_end: string }[]).map((r) => ({ start: new Date(r.block_start), end: new Date(r.block_end) }));
  }
  async insertAppointment(row: NewAppointment) {
    const { data, error } = await this.db.from("appointments").insert(row).select("*").single();
    if (error) { if (overlap(error)) throw new OverlapError(error.message); throw fail("booking failed", error); }
    return data as Appointment;
  }
  async getAppointment(id: string) {
    const { data, error } = await this.db.from("appointments").select("*").eq("id", id).maybeSingle();
    if (error) throw fail("booking lookup failed", error);
    return (data as Appointment | null) ?? null;
  }
  async getByTokenHash(hash: string) {
    const { data, error } = await this.db.from("appointments").select("*").eq("manage_token_hash", hash).maybeSingle();
    if (error) throw fail("booking lookup failed", error);
    return (data as Appointment | null) ?? null;
  }
  async updateAppointment(id: string, patch: Partial<Appointment>) {
    const { data, error } = await this.db.from("appointments").update(patch).eq("id", id).select("*").single();
    if (error) { if (overlap(error)) throw new OverlapError(error.message); throw fail("booking save failed", error); }
    return data as Appointment;
  }
  async listAppointments(from: Date, to: Date) {
    const { data, error } = await this.db.from("appointments").select("*").gte("starts_at", from.toISOString()).lt("starts_at", to.toISOString()).order("starts_at").limit(2000);
    if (error) throw fail("bookings failed", error);
    return (data ?? []) as Appointment[];
  }
  async listForContact(email: string) {
    const { data, error } = await this.db.from("appointments").select("*").eq("contact_email", email).order("starts_at", { ascending: false }).limit(100);
    if (error) throw fail("bookings failed", error);
    return (data ?? []) as Appointment[];
  }

  async insertReminders(rows: NewReminder[]) {
    if (!rows.length) return;
    const { error } = await this.db.from("appointment_reminders").upsert(rows, { onConflict: "appointment_id,channel,send_at", ignoreDuplicates: true });
    if (error) throw fail("reminders failed", error);
  }
  async cancelPendingReminders(appointmentId: string) {
    const { error } = await this.db.from("appointment_reminders").update({ status: "skipped", detail: "Appointment changed" }).eq("appointment_id", appointmentId).eq("status", "pending");
    if (error) throw fail("reminders failed", error);
  }
  async dueReminders(now: Date, limit: number) {
    const { data, error } = await this.db.from("appointment_reminders").select("*").eq("status", "pending").lte("send_at", now.toISOString()).order("send_at").limit(limit);
    if (error) throw fail("reminders failed", error);
    return (data ?? []) as ReminderRow[];
  }
  async claimReminder(id: string, now: Date) {
    const { data, error } = await this.db.from("appointment_reminders").update({ status: "sent", sent_at: now.toISOString() }).eq("id", id).eq("status", "pending").select("id");
    if (error) throw fail("reminders failed", error);
    return (data ?? []).length === 1;
  }
  async markReminder(id: string, status: "sent" | "failed" | "skipped", detail: string | null, now: Date) {
    const { error } = await this.db.from("appointment_reminders").update({ status, detail, sent_at: status === "sent" ? now.toISOString() : null }).eq("id", id);
    if (error) throw fail("reminders failed", error);
  }
}
