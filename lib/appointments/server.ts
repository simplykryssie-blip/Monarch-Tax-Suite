import "server-only";
import { randomUUID } from "node:crypto";
import { appOrigin } from "../admin";
import { automationDeps, safeEmit } from "../automation/server";
import { senderFor } from "../automation/engine.ts";
import { sanitizeError } from "../automation/sanitize.ts";
import { segmentCount, toE164 } from "../automation/twilio.ts";
import { SupabaseSendersRepo } from "../automation/supabase-senders.ts";
import { brandsOf } from "../brands.ts";
import { businessDeps } from "../calendar/server";
import { loadCalendar } from "../calendar/service.ts";
import { CrmSecrets } from "../crm/crypto.ts";
import { SupabaseDocumentsRepo } from "../documents/supabase-repo.ts";
import { formDeps } from "../forms/server";
import { readSettings } from "../forms/settings.ts";
import { formLink } from "../forms/link";
import { heldBack } from "../forms/after.ts";
import { peopleDeps } from "../people/server";
import { tenantSms } from "../sms/server";
import { tenantClient } from "../supabase/service";
import { currentTenantId } from "../tenants.ts";
import type { AppointmentDeps } from "./service.ts";
import { SupabaseAppointmentRepo } from "./supabase-repo.ts";
import type { Notifier } from "./types.ts";

// Server wiring for the calendar. The public booking page belongs to the office whose web address it was opened on;
// everything after that acts as that tenant only. Emails and texts go out from the office's own sender and Twilio
// account (texts spend its own credits). Outside production only the test recipients are ever contacted.

function secrets(): CrmSecrets {
  const s = CrmSecrets.fromBase64(process.env.MONARCH_ENCRYPTION_KEY);
  if (!s) throw new Error("MONARCH_ENCRYPTION_KEY is not configured, so booking links cannot be made.");
  return s;
}

export function appointmentDeps(tenantId: string = currentTenantId()): AppointmentDeps {
  const db = tenantClient(tenantId);
  const auto = automationDeps(tenantId);
  const senders = new SupabaseSendersRepo(db);
  const docs = new SupabaseDocumentsRepo(db);
  const origin = async () => {
    const domains = await senders.listDomains().catch(() => []);
    const only = brandsOf(domains).length === 1 ? brandsOf(domains)[0] : null;
    return process.env.VERCEL_ENV === "production" && only?.linkHost ? `https://${only.linkHost}` : await appOrigin();
  };
  const testList = auto.config.testRecipients.map((r) => r.toLowerCase());
  const notify: Notifier = {
    async email(to, subject, text) {
      if (auto.config.env !== "production" && !testList.includes(to.toLowerCase())) return { ok: false, message: heldBack(auto, to) };
      try {
        const from = await senderFor(auto, null);
        const r = await auto.email.send({ ...from, to, subject, text, html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;white-space:pre-wrap">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</div>`, idempotencyKey: `appt:${randomUUID()}` });
        return r.ok ? { ok: true } : { ok: false, message: sanitizeError(r.message, 200) };
      } catch (e) {
        return { ok: false, message: sanitizeError(e, 200) };
      }
    },
    async sms(to, body) {
      const e164 = toE164(to);
      if (!e164) return { ok: false, message: "That isn't a valid mobile number." };
      if (auto.config.env !== "production" && !testList.map((r) => toE164(r)).includes(e164)) return { ok: false, message: "Not sent: outside production only test recipients are texted." };
      const sms = await tenantSms(tenantId);
      if (!sms.sender) return { ok: false, message: sms.route.ok ? "Text messaging is not connected." : sms.route.problem };
      const reference = `appointment-reminder:${randomUUID()}`;
      const segments = segmentCount(body);
      const credits = sms.route.billing === "credits";
      if (credits && !(await sms.repo.spend(segments, reference))) return { ok: false, message: "Not enough text credits." };
      const result = await sms.sender.send(e164, body);
      if (!result.ok && credits) await sms.repo.reverseSend(reference);
      return result.ok ? { ok: true } : { ok: false, message: sanitizeError(result.message, 200) };
    },
  };
  return {
    tenantId,
    repo: new SupabaseAppointmentRepo(db),
    calendar: () => loadCalendar(businessDeps(tenantId)),
    people: peopleDeps(tenantId),
    notify,
    firmName: async () => (await docs.getProfile().catch(() => null))?.display_name ?? "Our office",
    firmSignature: async () => {
      const p = await docs.getProfile().catch(() => null);
      return [p?.display_name, p?.address, [p?.phone, p?.email].filter(Boolean).join(" · ")].filter(Boolean).join("\n");
    },
    intakeLink: async (formId) => {
      const fd = formDeps(tenantId);
      const form = await fd.repo.getForm(formId);
      if (!form || form.status !== "published") return null;
      return formLink(fd, form.public_id, readSettings(form.settings));
    },
    tokenFor: (id) => secrets().hashIdentifier("appointment-link", `${tenantId}:${id}`),
    manageUrl: async (token) => `${await origin()}/book/manage/${token}`,
    emit: (type, a) => safeEmit({ type, key: `${type}:${a.id}:${a.updated_at}`, subject: { type: "appointment", id: a.id }, data: { source: a.source } }),
  };
}
