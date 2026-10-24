import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { tenantClient } from "../supabase/service";
import { TAG_MAX } from "../leads/tags.ts";
import type { Contact, ContactPort, SendTextResult } from "./contact.ts";

// The Automation Center's view of people: found from what an event is about, changed through the tenant's own records.

type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const money = (cents: unknown) => (typeof cents === "number" ? `$${(cents / 100).toFixed(2)}` : "");
const longDate = (d: unknown) => (typeof d === "string" ? new Intl.DateTimeFormat("en-US", { timeZone: "UTC", dateStyle: "long" }).format(new Date(`${d}T12:00:00Z`)) : "");

export class SupabaseContacts implements ContactPort {
  private db: SupabaseClient;
  constructor(private tenantId: string) {
    this.db = tenantClient(tenantId);
  }

  private async one(table: string, column: string, value: string): Promise<Row | null> {
    const { data, error } = await this.db.from(table).select("*").eq(column, value).limit(1).maybeSingle();
    if (error) throw new Error(`${table} lookup failed: ${error.message}`);
    return (data as Row | null) ?? null;
  }

  /** The lead and client records of a person, found by email, with what a base record already knows about them. */
  private async build(base: { name: string | null; email: string | null; phone: string | null; smsConsent: boolean; leadId?: string; clientId?: string; customerId?: string | null; variables?: Record<string, string> }): Promise<Contact> {
    const email = base.email?.trim().toLowerCase() || null;
    const lead = base.leadId ? await this.one("leads", "id", base.leadId) : email ? await this.one("leads", "email", email) : null;
    const client = base.clientId ? await this.one("clients", "id", base.clientId) : email ? await this.one("clients", "email", email) : null;
    const tags = [...new Set([...((lead?.tags as string[] | undefined) ?? []), ...((client?.tags as string[] | undefined) ?? [])])];
    return {
      name: base.name ?? str(lead?.full_name) ?? str(client?.full_name),
      email: email ?? str(lead?.email) ?? str(client?.email),
      phone: base.phone ?? str(lead?.phone) ?? str(client?.phone),
      smsConsent: base.smsConsent,
      leadId: str(lead?.id), clientId: str(client?.id), customerId: base.customerId ?? null,
      tags, leadStatus: str(lead?.status),
      variables: base.variables ?? {},
    };
  }

  async resolve(event: { subject_type?: string | null; subject_id?: string | null; customer_id?: string | null }): Promise<Contact | null> {
    const id = event.subject_id;
    if (event.subject_type && id) {
      if (event.subject_type === "appointment") {
        const a = await this.one("appointments", "id", id);
        if (!a) return null;
        const { whenFor } = await import("../appointments/messages.ts");
        const { appointmentDeps } = await import("../appointments/server");
        const type = await this.one("appointment_types", "id", String(a.type_id));
        const deps = appointmentDeps(this.tenantId);
        return this.build({
          name: str(a.contact_name), email: str(a.contact_email), phone: str(a.contact_phone), smsConsent: a.sms_consent === true,
          variables: {
            appointment_time: whenFor(a as never), appointment_type: str(type?.name) ?? "your appointment",
            appointment_link: await deps.manageUrl(deps.tokenFor(id)).catch(() => ""),
          },
        });
      }
      if (event.subject_type === "lead") {
        const l = await this.one("leads", "id", id);
        return l ? this.build({ name: str(l.full_name), email: str(l.email), phone: str(l.phone), smsConsent: false, leadId: id }) : null;
      }
      if (event.subject_type === "client") {
        const c = await this.one("clients", "id", id);
        return c ? this.build({ name: str(c.full_name), email: str(c.email), phone: str(c.phone), smsConsent: false, clientId: id }) : null;
      }
      if (event.subject_type === "invoice") {
        const inv = await this.one("invoices", "id", id);
        const c = inv ? await this.one("clients", "id", String(inv.client_id)) : null;
        return c ? this.build({ name: str(c.full_name), email: str(c.email), phone: str(c.phone), smsConsent: false, clientId: String(c.id), variables: { invoice_number: str(inv?.number) ?? "", invoice_total: money(inv?.total_cents), invoice_due: longDate(inv?.due_on) } }) : null;
      }
      if (event.subject_type === "return") {
        const r = await this.one("client_returns", "id", id);
        const c = r ? await this.one("clients", "id", String(r.client_id)) : null;
        return c ? this.build({ name: str(c.full_name), email: str(c.email), phone: str(c.phone), smsConsent: false, clientId: String(c.id) }) : null;
      }
    }
    if (event.customer_id) {
      const c = await this.one("calculator_customers", "id", event.customer_id);
      if (c) return this.build({ name: str(c.full_name), email: str(c.email), phone: null, smsConsent: false, customerId: String(c.id) });
    }
    return null;
  }

  private async changeTags(c: Contact, change: (tags: string[]) => string[] | null): Promise<number> {
    let changed = 0;
    for (const [table, id] of [["leads", c.leadId], ["clients", c.clientId]] as const) {
      if (!id) continue;
      const row = await this.one(table, "id", id);
      const next = change(((row?.tags as string[] | undefined) ?? []).slice());
      if (!next) continue;
      const { error } = await this.db.from(table).update({ tags: next }).eq("id", id);
      if (error) throw new Error(`${table} tag update failed: ${error.message}`);
      changed++;
    }
    c.tags = [...new Set([...(c.tags ?? [])])];
    return changed;
  }

  async moveStage(event: { subject_type?: string | null; subject_id?: string | null; data: Record<string, unknown> }, pipelineId: string, stageId: string) {
    const pipeline = await this.one("pipelines", "id", pipelineId);
    const stages = (pipeline?.stages as { id: string; name: string }[] | undefined) ?? [];
    const target = stages.find((s) => s.id === stageId);
    if (!pipeline || pipeline.archived_at || !target) return { moved: false, reason: "That pipeline or stage no longer exists. Choose it again in the workflow." };
    const workId = typeof event.data.work_id === "string" ? event.data.work_id : null;
    const table = event.subject_type === "return" && event.subject_id ? "client_returns" : workId ? "client_work" : null;
    const id = table === "client_returns" ? event.subject_id : workId;
    if (!table || !id) return { moved: false, reason: "This event isn't about a return or a piece of work, so there is nothing to move." };
    if ((table === "client_returns") !== (pipeline.kind === "returns")) return { moved: false, reason: `This event is about ${table === "client_returns" ? "a tax return" : "other work"}, but the step points at the ${pipeline.name} pipeline.` };
    const row = await this.one(table, "id", id);
    if (!row) return { moved: false, reason: "That return or work no longer exists." };
    if (table === "client_work" && row.pipeline_id !== pipelineId) return { moved: false, reason: `This work isn't in the ${pipeline.name} pipeline.` };
    if (row.stage_id === stageId) return { moved: false, reason: `Already in ${target.name}.` };
    const from = stages.find((s) => s.id === row.stage_id)?.name;
    const { error } = await this.db.from(table).update({ stage_id: stageId }).eq("id", id);
    if (error) throw new Error(`${table} stage update failed: ${error.message}`);
    return { moved: true, from, to: target.name };
  }

  async addTag(c: Contact, tag: string) {
    const n = await this.changeTags(c, (tags) => (tags.includes(tag) || tags.length >= TAG_MAX ? null : [...tags, tag]));
    if (n && !c.tags.includes(tag)) c.tags.push(tag);
    return n;
  }
  async removeTag(c: Contact, tag: string) {
    const n = await this.changeTags(c, (tags) => (tags.includes(tag) ? tags.filter((t) => t !== tag) : null));
    c.tags = c.tags.filter((t) => t !== tag);
    return n;
  }

  async setLeadStatus(c: Contact, status: string) {
    if (!c.leadId) return false;
    const { error } = await this.db.from("leads").update({ status }).eq("id", c.leadId);
    if (error) throw new Error(`lead update failed: ${error.message}`);
    c.leadStatus = status;
    return true;
  }

  async createTask(t: { title: string; dueOn: string | null; contact: Contact | null; executionId: string }) {
    const { error } = await this.db.from("automation_tasks").insert({
      title: t.title, due_on: t.dueOn, contact_name: t.contact?.name ?? null, contact_email: t.contact?.email ?? null,
      client_id: t.contact?.clientId ?? null, lead_id: t.contact?.leadId ?? null, execution_id: t.executionId,
    });
    if (!error) return true;
    if (error.code === "23505") return false; // this run already made it
    throw new Error(`task save failed: ${error.message}`);
  }

  async sendText(c: Contact, body: string): Promise<SendTextResult> {
    if (!c.phone) return { ok: false, kind: "permanent", message: "There is no mobile number for this person." };
    const { appointmentDeps } = await import("../appointments/server");
    const r = await appointmentDeps(this.tenantId).notify.sms(c.phone, body);
    if (r.ok) return { ok: true };
    return { ok: false, kind: /credit|connected|configured|registration|number/i.test(r.message) ? "config" : "transient", message: r.message };
  }
}
