import { allowedHosts } from "../commerce/embed.ts";
import { licensedYears } from "../commerce/versions.ts";
import { ValidationError } from "../commerce/validation.ts";
import { HighLevelError } from "./highlevel.ts";
import { nowOf, requireConfigured, withAccessToken, type CrmDeps } from "./connection.ts";
import { DEFAULT_LEAD_SETTINGS, type CalculatorLead, type LeadPayload, type LeadStatus } from "./types.ts";

// Calculator lead capture and delivery to the buyer's own HighLevel location.
//
// Policy (also shown to buyers):
//  - The lead form appears only on licensed embeds whose buyer turned lead
//    capture on with a working connection. Monarch's own pages never send leads.
//  - Each lead is stored encrypted, then delivered. Temporary failures (rate
//    limits, HighLevel outages) are retried with backoff up to 8 attempts.
//    Expired authorization holds leads as "reauthorization required" until the
//    buyer reconnects. Nothing is discarded silently: undelivered leads stay
//    visible to the buyer in their portal.
//  - Contact details are removed once delivered, and after 30 days if never
//    delivered. Lead history (status, masked email) is deleted after 365 days.

export const MAX_ATTEMPTS = 8;
const BACKOFF_MIN = [1, 5, 15, 60, 240, 720, 1440];
export const PAYLOAD_RETENTION_DAYS = 30;
export const HISTORY_RETENTION_DAYS = 365;
const LIMIT_PER_IP_10_MIN = 5;
const LIMIT_PER_LICENSE_HOUR = 300;
const EMBED_TOKEN_TTL_S = 4 * 60 * 60;

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  received: "Lead received",
  sending: "Lead received",
  sent: "Sent successfully",
  retry_pending: "Retry pending",
  reauth_required: "Reauthorization required",
  failed: "Delivery failed",
};

const FILING: Record<string, string> = { single: "Single", married: "Married filing jointly", head: "Head of household", separate: "Married filing separately" };

export type EmbedTokenPayload = { l: string; h: string | null; e: number };

/** Signed token handed to a licensed embed when lead capture is on; the lead endpoint accepts nothing else as the destination. */
export function issueEmbedToken(deps: CrmDeps, licenseId: string, host: string | null): string {
  const { secrets } = requireConfigured(deps);
  return secrets.sign("embed-token", { l: licenseId, h: host, e: Math.floor(nowOf(deps).getTime() / 1000) + EMBED_TOKEN_TTL_S } satisfies EmbedTokenPayload);
}

/** Whether a license currently shows the lead form. */
export async function leadCaptureActive(deps: CrmDeps, licenseId: string) {
  if (!deps.api || !deps.secrets) return null;
  const [settings, connection] = await Promise.all([deps.repo.getLeadSettings(licenseId), deps.repo.getLiveConnection(licenseId)]);
  return settings?.enabled && connection ? settings : null;
}

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");

export function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const [user, domain] = email.split("@");
  return `${user.slice(0, 1)}***@${domain}`.slice(0, 80);
}

export type LeadSubmission = {
  token: string;
  submissionId: string;
  firstName: unknown;
  lastName?: unknown;
  email?: unknown;
  phone?: unknown;
  consent: unknown;
  website?: unknown; // honeypot: real visitors never fill it
  summary?: { taxYear?: unknown; filingStatus?: unknown; result?: unknown; amount?: unknown } | null;
};

/** Validates visitor input. Only what the visitor typed (and the estimate, when the buyer enabled it) is kept. */
export function parseLead(input: LeadSubmission, opts: { years: number[]; includeSummary: boolean; now: Date }): LeadPayload {
  const firstName = clean(input.firstName, 60);
  if (!firstName) throw new ValidationError("Enter your first name.");
  const email = clean(input.email, 254).toLowerCase() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) throw new ValidationError("Enter a valid email address.");
  const rawPhone = clean(input.phone, 40);
  const phone = rawPhone ? rawPhone.replace(/[\s().-]/g, "") : null;
  if (phone && !/^\+?[0-9]{7,15}$/.test(phone)) throw new ValidationError("Enter a valid phone number.");
  if (!email && !phone) throw new ValidationError("Enter an email address or phone number.");
  if (input.consent !== true) throw new ValidationError("Please agree to be contacted.");
  let summary: LeadPayload["summary"] = null;
  const s = input.summary;
  if (opts.includeSummary && s) {
    const taxYear = Number(s.taxYear);
    const amount = Number(s.amount);
    if (opts.years.includes(taxYear) && typeof s.filingStatus === "string" && FILING[s.filingStatus] && (s.result === "refund" || s.result === "owed") && Number.isFinite(amount) && amount >= 0 && amount <= 10_000_000) {
      summary = { taxYear, filingStatus: s.filingStatus, result: s.result, amount: Math.round(amount) };
    }
  }
  return { firstName, lastName: clean(input.lastName, 60) || null, email, phone, summary, submittedAt: opts.now.toISOString() };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const leadAad = (licenseId: string, submissionId: string) => `lead:${licenseId}:${submissionId}`;

export type SubmitResult = { accepted: true; leadId: string | null } | { accepted: false; reason: "rate_limited" | "unavailable" };

/**
 * Accepts a lead from a licensed embed. The destination comes only from the
 * signed embed token (license) and that license's saved connection: callers
 * cannot name a location, license or customer.
 */
export async function submitLead(deps: CrmDeps, input: LeadSubmission, ctx: { ip: string | null }): Promise<SubmitResult> {
  const { secrets } = requireConfigured(deps);
  const token = secrets.verify<EmbedTokenPayload>("embed-token", input.token, nowOf(deps).getTime());
  if (!token) throw new ValidationError("This form has expired. Reload the page and try again.");
  if (typeof input.submissionId !== "string" || !UUID.test(input.submissionId)) throw new ValidationError("Invalid submission.");

  const license = await deps.commerce.getLicense(token.l);
  if (!license || license.status !== "active") return { accepted: false, reason: "unavailable" };
  if (token.h && !allowedHosts(await deps.commerce.listDomains(license.id)).includes(token.h)) return { accepted: false, reason: "unavailable" };
  const settings = await leadCaptureActive(deps, license.id);
  const connection = settings ? await deps.repo.getLiveConnection(license.id) : null;
  if (!settings || !connection) return { accepted: false, reason: "unavailable" };

  const now = nowOf(deps);
  const payload = parseLead(input, { years: licensedYears(license), includeSummary: settings.include_summary, now });
  if (typeof input.website === "string" && input.website.trim()) return { accepted: true, leadId: null }; // bot: pretend success, store nothing

  const ipHash = ctx.ip ? secrets.hashIp(ctx.ip) : null;
  if (ipHash && (await deps.repo.countLeadsSince({ ip_hash: ipHash }, new Date(now.getTime() - 10 * 60_000).toISOString())) >= LIMIT_PER_IP_10_MIN) {
    return { accepted: false, reason: "rate_limited" };
  }
  if ((await deps.repo.countLeadsSince({ license_id: license.id }, new Date(now.getTime() - 3_600_000).toISOString())) >= LIMIT_PER_LICENSE_HOUR) {
    return { accepted: false, reason: "rate_limited" };
  }

  const { lead } = await deps.repo.insertLead({
    license_id: license.id,
    connection_id: connection.id,
    submission_id: input.submissionId.toLowerCase(),
    location_id: connection.location_id,
    status: connection.status === "connected" ? "received" : "reauth_required",
    payload_enc: secrets.encrypt(JSON.stringify(payload), leadAad(license.id, input.submissionId.toLowerCase())),
    email_masked: maskEmail(payload.email),
    embed_host: token.h,
    ip_hash: ipHash,
    next_attempt_at: now.toISOString(),
  });
  return { accepted: true, leadId: lead.id };
}

function noteText(p: LeadPayload, host: string | null): string {
  const s = p.summary!;
  const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(s.amount);
  return [
    `Monarch Basic Tax Calculator estimate (submitted ${p.submittedAt.slice(0, 10)})`,
    `Tax year: ${s.taxYear} · Filing status: ${FILING[s.filingStatus]}`,
    `${s.result === "refund" ? "Estimated refund" : "Estimated amount owed"}: ${amount}`,
    "Educational estimate from figures the visitor entered; not tax advice or a tax return.",
    host ? `Submitted on: ${host}` : null,
  ].filter(Boolean).join("\n");
}

function backoff(attempts: number, now: Date) {
  return new Date(now.getTime() + BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)] * 60_000).toISOString();
}

/** Delivers one lead if it is due. Safe to call concurrently and repeatedly. */
export async function deliverLead(deps: CrmDeps, leadId: string): Promise<CalculatorLead | null> {
  const { api, secrets } = requireConfigured(deps);
  const now = nowOf(deps);
  const lead = await deps.repo.claimLead(leadId, new Date(now.getTime() + 60_000).toISOString(), now.toISOString());
  if (!lead) return null;
  const connection = await deps.repo.getLiveConnection(lead.license_id);
  if (!connection) return deps.repo.updateLead(lead.id, { status: "failed", last_error: "GoHighLevel is not connected.", lock_until: null, next_attempt_at: null });
  if (connection.status !== "connected") return deps.repo.updateLead(lead.id, { status: "reauth_required", last_error: "Waiting for the buyer to reconnect GoHighLevel.", lock_until: null, connection_id: connection.id });
  if (!lead.payload_enc) return deps.repo.updateLead(lead.id, { status: "failed", last_error: "Lead details are no longer available.", lock_until: null, next_attempt_at: null });

  const payload = JSON.parse(secrets.decrypt(lead.payload_enc, leadAad(lead.license_id, lead.submission_id))) as LeadPayload;
  const settings = (await deps.repo.getLeadSettings(lead.license_id)) ?? DEFAULT_LEAD_SETTINGS(lead.license_id);
  let state: CalculatorLead = await deps.repo.updateLead(lead.id, { connection_id: connection.id, location_id: connection.location_id, attempts: lead.attempts + 1 });
  // A contact found or created in a different location (after a reconnect) is not reused.
  if (lead.location_id && lead.location_id !== connection.location_id) {
    state = await deps.repo.updateLead(lead.id, { ghl_contact_id: null, contact_created: null, tags_applied: false, note_added: false });
  }

  try {
    await withAccessToken(deps, connection, async (token, c) => {
      const contact = { locationId: c.location_id, firstName: payload.firstName, lastName: payload.lastName ?? undefined, email: payload.email ?? undefined, phone: payload.phone ?? undefined, source: settings.lead_source };
      if (!state.ghl_contact_id) {
        let id: string | null = null;
        let created = false;
        if (settings.update_existing) {
          // Matching follows the location's "Allow Duplicate Contact" setting.
          ({ id, created } = await api.upsertContact(token, contact));
        } else {
          // Existing contacts are left unchanged; a retry after a lost response finds the contact created earlier.
          if (payload.email) id = await api.findDuplicate(token, c.location_id, { email: payload.email });
          if (!id && payload.phone) id = await api.findDuplicate(token, c.location_id, { phone: payload.phone });
          if (!id) {
            id = await api.createContact(token, contact);
            created = true;
          }
        }
        state = await deps.repo.updateLead(lead.id, { ghl_contact_id: id, contact_created: created });
      }
      if (settings.tags.length && !state.tags_applied) {
        await api.addTags(token, state.ghl_contact_id!, settings.tags); // adds; never replaces existing tags
        state = await deps.repo.updateLead(lead.id, { tags_applied: true });
      }
      if (settings.include_summary && payload.summary && !state.note_added) {
        await api.addNote(token, state.ghl_contact_id!, noteText(payload, lead.embed_host));
        state = await deps.repo.updateLead(lead.id, { note_added: true });
      }
    });
  } catch (e) {
    const message = (e instanceof Error ? e.message : "Delivery failed.").slice(0, 500);
    if (e instanceof HighLevelError && e.kind === "auth") {
      return deps.repo.updateLead(lead.id, { status: "reauth_required", last_error: "Authorization expired. Reconnect GoHighLevel to deliver this lead.", lock_until: null });
    }
    const retryable = !(e instanceof HighLevelError) || e.kind === "retryable";
    if (retryable && state.attempts < MAX_ATTEMPTS) {
      return deps.repo.updateLead(lead.id, { status: "retry_pending", last_error: message, next_attempt_at: backoff(state.attempts, now), lock_until: null });
    }
    await deps.repo.updateConnection(connection.id, { last_error: message, last_error_at: now.toISOString() });
    return deps.repo.updateLead(lead.id, { status: "failed", last_error: message, next_attempt_at: null, lock_until: null });
  }

  const done = nowOf(deps).toISOString();
  await deps.repo.updateConnection(connection.id, { last_success_at: done, last_error: null });
  // Delivered: the contact now lives in the buyer's CRM, so the stored copy is removed.
  return deps.repo.updateLead(lead.id, { status: "sent", delivered_at: done, last_error: null, next_attempt_at: null, lock_until: null, payload_enc: null, payload_purged_at: done });
}

/** Delivers due leads (new, retries, stale locks), optionally for one license. */
export async function processDueLeads(deps: CrmDeps, opts: { limit?: number; licenseId?: string } = {}) {
  if (!deps.api || !deps.secrets) return { processed: 0 };
  const ids = await deps.repo.listDueLeadIds(nowOf(deps).toISOString(), opts.limit ?? 25, opts.licenseId);
  for (const id of ids) {
    try {
      await deliverLead(deps, id);
    } catch {
      // A broken lead must not block the others; it stays due and is retried.
    }
  }
  return { processed: ids.length };
}

/** Retention: removes contact details of old undelivered leads and old history rows. */
export async function purgeLeads(deps: CrmDeps) {
  const now = nowOf(deps).getTime();
  const ids = await deps.repo.listPurgeableLeadIds(new Date(now - PAYLOAD_RETENTION_DAYS * 86_400_000).toISOString(), 500);
  for (const id of ids) {
    const lead = await deps.repo.getLead(id);
    if (!lead) continue;
    await deps.repo.updateLead(id, {
      payload_enc: null,
      ip_hash: null,
      payload_purged_at: new Date(now).toISOString(),
      ...(lead.status === "sent" ? {} : { status: "failed" as const, next_attempt_at: null, last_error: `Not delivered within ${PAYLOAD_RETENTION_DAYS} days; contact details were removed.` }),
    });
  }
  const deleted = await deps.repo.deleteLeadsBefore(new Date(now - HISTORY_RETENTION_DAYS * 86_400_000).toISOString());
  return { purged: ids.length, deleted };
}

/** Decrypted details of a lead that was not delivered, for the owning buyer only (fallback follow-up). */
export function readLeadDetails(deps: CrmDeps, lead: CalculatorLead): LeadPayload | null {
  if (!lead.payload_enc || !deps.secrets) return null;
  return JSON.parse(deps.secrets.decrypt(lead.payload_enc, leadAad(lead.license_id, lead.submission_id))) as LeadPayload;
}
