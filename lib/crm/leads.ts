import { allowedHosts } from "../commerce/embed.ts";
import { computeFull, fullEstimateForLead, fullEstimateText, FULL_TAX_YEAR, NEEDS_INCOME_MESSAGE, sanitizeFullInputs } from "../calculator/full.ts";
import { licensedYears } from "../commerce/versions.ts";
import { ValidationError } from "../commerce/validation.ts";
import { HighLevelError } from "./highlevel.ts";
import { nowOf, requireSecrets, webhookTarget, withAccessToken, type CrmDeps } from "./connection.ts";
import { sendWebhook } from "./webhook.ts";
import type { CrmConnection, LeadPayload, LeadSettings } from "./types.ts";

// Direct lead forwarding. A submission is validated and forwarded to the
// buyer's own destination during the visitor's request, then discarded:
// nothing about the visitor is written to Monarch's database or logs. If the
// destination fails, the visitor gets a clear error and can retry from the
// form (the same submission id is reused, so retries do not duplicate).
//
// Monarch keeps only a delivery log without personal data (license, outcome,
// HTTP status, duration) and, for rate limiting, a keyed hash of the IP that
// is cleared after 24 hours. Log rows are deleted after 30 days.

const LIMIT_PER_IP_10_MIN = 5;
const LIMIT_PER_LICENSE_HOUR = 300;
const EMBED_TOKEN_TTL_S = 4 * 60 * 60;
const FILING: Record<string, string> = { single: "Single", married: "Married filing jointly", head: "Head of household", separate: "Married filing separately" };

export type EmbedTokenPayload = { l: string; h: string | null; e: number };

/** Signed token handed to a licensed embed when its lead form is on; the lead endpoint accepts nothing else as the destination. */
export function issueEmbedToken(deps: CrmDeps, licenseId: string, host: string | null): string {
  return requireSecrets(deps).sign("embed-token", { l: licenseId, h: host, e: Math.floor(nowOf(deps).getTime() / 1000) + EMBED_TOKEN_TTL_S } satisfies EmbedTokenPayload);
}

/** Lead settings when the form should show: enabled, with a connected destination of a kind Monarch can currently reach. */
export async function leadCaptureActive(deps: CrmDeps, licenseId: string): Promise<{ settings: LeadSettings; connection: CrmConnection } | null> {
  if (!deps.secrets) return null;
  const [settings, connection] = await Promise.all([deps.repo.getLeadSettings(licenseId), deps.repo.getLiveConnection(licenseId)]);
  if (!settings?.enabled || !settings.business_name || !connection || connection.status !== "connected") return null;
  if (connection.provider === "highlevel" && !deps.api) return null;
  return { settings, connection };
}

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type LeadSubmission = {
  token: string;
  submissionId: string;
  firstName: unknown;
  lastName?: unknown;
  email?: unknown;
  phone?: unknown;
  consent: unknown;
  website?: unknown; // honeypot
  summary?: { taxYear?: unknown; filingStatus?: unknown; result?: unknown; amount?: unknown } | null;
  /** Full calculator: the visitor's entries. Used only to recompute the results on the server; never forwarded or stored. */
  inputs?: unknown;
};

/** Validates visitor input; keeps only what the visitor typed (and the disclosed estimate summary, when enabled). */
export function parseLead(input: LeadSubmission, opts: { years: number[]; includeSummary: boolean; now: Date }): LeadPayload {
  if (typeof input.submissionId !== "string" || !UUID.test(input.submissionId)) throw new ValidationError("Invalid submission.");
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
  let estimate: LeadPayload["estimate"] = null;
  if (opts.includeSummary && input.inputs && opts.years.includes(FULL_TAX_YEAR)) {
    const inputs = sanitizeFullInputs(input.inputs);
    if (!inputs) throw new ValidationError("Check the calculator entries and try again.");
    const result = computeFull(inputs);
    if (!result) throw new ValidationError(NEEDS_INCOME_MESSAGE);
    estimate = fullEstimateForLead(result, inputs.status);
  }
  return { submissionId: input.submissionId.toLowerCase(), firstName, lastName: clean(input.lastName, 60) || null, email, phone, summary, estimate, submittedAt: opts.now.toISOString() };
}

function noteText(p: LeadPayload, host: string | null): string {
  if (p.estimate) return [`Tax calculator estimate (submitted ${p.submittedAt.slice(0, 10)})`, fullEstimateText(p.estimate), host ? `Submitted on: ${host}` : null].filter(Boolean).join("\n");
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

/** The JSON body sent to webhooks (documented contract). */
export function webhookBody(p: LeadPayload, settings: LeadSettings, host: string | null) {
  return {
    event: "calculator.lead",
    id: p.submissionId,
    submitted_at: p.submittedAt,
    source: settings.lead_source,
    website: host,
    tags: settings.tags,
    contact: { first_name: p.firstName, last_name: p.lastName, email: p.email, phone: p.phone },
    estimate: p.estimate ? { ...p.estimate, text: fullEstimateText(p.estimate) } : p.summary ? { tax_year: p.summary.taxYear, filing_status: p.summary.filingStatus, result: p.summary.result, amount: p.summary.amount, currency: "USD" } : null,
    consent: { contact: true, text_shown: `Agreed to be contacted by ${settings.business_name} about this estimate.` },
  };
}

async function toHighLevel(deps: CrmDeps, connection: CrmConnection, settings: LeadSettings, p: LeadPayload, host: string | null) {
  const api = deps.api!;
  await withAccessToken(deps, connection, async (token, c) => {
    const locationId = c.location_id!;
    const contact = { locationId, firstName: p.firstName, lastName: p.lastName ?? undefined, email: p.email ?? undefined, phone: p.phone ?? undefined, source: settings.lead_source };
    let id: string | null = null;
    if (settings.update_existing) {
      // Matching follows the location's "Allow Duplicate Contact" setting.
      ({ id } = await api.upsertContact(token, contact));
    } else {
      // Existing contacts are left unchanged; a visitor's retry finds the contact created on the first attempt.
      if (p.email) id = await api.findDuplicate(token, locationId, { email: p.email });
      if (!id && p.phone) id = await api.findDuplicate(token, locationId, { phone: p.phone });
      if (!id) id = await api.createContact(token, contact);
    }
    if (settings.tags.length) await api.addTags(token, id, settings.tags); // adds; never replaces existing tags
    if (settings.include_summary && (p.estimate || p.summary)) await api.addNote(token, id, noteText(p, host));
  });
}

export type ForwardResult =
  | { ok: true }
  | { ok: false; reason: "unavailable" | "rate_limited" | "destination_failed"; retryable: boolean };

/**
 * Validates a submission from a licensed embed and forwards it to the buyer's
 * destination immediately. The destination is resolved only from the signed
 * embed token (license) and that license's saved connection.
 */
export async function forwardLead(deps: CrmDeps, input: LeadSubmission, ctx: { ip: string | null }): Promise<ForwardResult> {
  const secrets = requireSecrets(deps);
  const now = nowOf(deps);
  const token = secrets.verify<EmbedTokenPayload>("embed-token", input.token, now.getTime());
  if (!token) throw new ValidationError("This form has expired. Reload the page and try again.");

  const license = await deps.commerce.getLicense(token.l);
  if (!license || license.status !== "active") return { ok: false, reason: "unavailable", retryable: false };
  if (token.h && !allowedHosts(await deps.commerce.listDomains(license.id)).includes(token.h)) return { ok: false, reason: "unavailable", retryable: false };
  const active = await leadCaptureActive(deps, license.id);
  if (!active) return { ok: false, reason: "unavailable", retryable: false };
  const { settings, connection } = active;

  const payload = parseLead(input, { years: licensedYears(license), includeSummary: settings.include_summary, now });
  if (typeof input.website === "string" && input.website.trim()) return { ok: true }; // honeypot: pretend success, forward nothing

  const ipHash = ctx.ip ? secrets.hashIp(ctx.ip) : null;
  const log = (outcome: "sent" | "failed" | "rejected", reason: string | null, http_status: number | null = null) =>
    deps.repo.logDelivery({ license_id: license.id, provider: connection.provider, outcome, reason, http_status, duration_ms: nowOf(deps).getTime() - now.getTime(), ip_hash: ipHash }).catch(() => undefined);
  if (ipHash && (await deps.repo.countDeliveries({ ip_hash: ipHash }, new Date(now.getTime() - 10 * 60_000).toISOString())) >= LIMIT_PER_IP_10_MIN) {
    await log("rejected", "rate_limited_ip");
    return { ok: false, reason: "rate_limited", retryable: false };
  }
  if ((await deps.repo.countDeliveries({ license_id: license.id }, new Date(now.getTime() - 3_600_000).toISOString())) >= LIMIT_PER_LICENSE_HOUR) {
    await log("rejected", "rate_limited_license");
    return { ok: false, reason: "rate_limited", retryable: false };
  }

  // Bounded in-request retries for transient failures only (never for rejected credentials or bad data).
  // The submission id doubles as the idempotency key, so a retry cannot create a second contact or event.
  const delays = deps.leadRetryDelaysMs ?? [];
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  type Attempt = { ok: true; status: number } | { ok: false; retryable: boolean; kind: "auth" | "transient" | "permanent"; reason: string; status: number | null; message: string };
  const attempt = async (): Promise<Attempt> => {
    try {
      if (connection.provider === "webhook") {
        const result = await (deps.webhook ?? sendWebhook)(webhookTarget(deps, connection), webhookBody(payload, settings, token.h), payload.submissionId);
        if (result.ok) return { ok: true, status: result.status };
        const transient = result.status === null || result.status >= 500 || result.status === 429 || result.status === 408;
        return { ok: false, retryable: transient, kind: transient ? "transient" : "permanent", reason: result.reason, status: result.status, message: `Delivery failed: ${result.reason}${result.status ? ` (HTTP ${result.status})` : ""}` };
      }
      await toHighLevel(deps, connection, settings, payload, token.h);
      return { ok: true, status: 200 };
    } catch (e) {
      if (e instanceof HighLevelError) {
        return { ok: false, retryable: e.kind === "retryable", kind: e.kind === "auth" ? "auth" : e.kind === "permanent" ? "permanent" : "transient", reason: `highlevel_${e.kind}`, status: e.status, message: `Delivery failed: ${e.message.slice(0, 300)}` };
      }
      return { ok: false, retryable: true, kind: "transient", reason: "error", status: null, message: `Delivery failed: ${e instanceof Error ? e.message.slice(0, 300) : "error"}` };
    }
  };
  let outcome = await attempt();
  for (let i = 0; !outcome.ok && outcome.retryable && i < delays.length; i++) {
    await sleep(delays[i]);
    outcome = await attempt();
  }
  try {
    if (!outcome.ok) {
      await log("failed", outcome.reason, outcome.status);
      if (outcome.kind !== "auth") await deps.repo.updateConnection(connection.id, { last_error: outcome.message, last_error_at: nowOf(deps).toISOString() }).catch(() => undefined);
      // No lead contents are kept (privacy policy); the visitor is asked to try again. Only the outcome is recorded.
      await emitSafe(deps, { type: "lead.delivery_failed", key: `lead:${payload.submissionId}:failed`, licenseId: license.id, customerId: license.customer_id, data: { provider: connection.provider, error_kind: outcome.kind } });
      return { ok: false, reason: "destination_failed", retryable: outcome.kind !== "permanent" };
    }
    await log("sent", null, outcome.status);
  } finally {
    // Opportunistic retention: no scheduled job is needed.
    await deps.repo.pruneDeliveryLog(new Date(now.getTime() - 86_400_000).toISOString(), new Date(now.getTime() - 30 * 86_400_000).toISOString()).catch(() => undefined);
  }
  await deps.repo.updateConnection(connection.id, { last_success_at: nowOf(deps).toISOString(), last_error: null }).catch(() => undefined);
  await emitSafe(deps, { type: "lead.delivered", key: `lead:${payload.submissionId}:delivered`, licenseId: license.id, customerId: license.customer_id, data: { provider: connection.provider } });
  return { ok: true };
}

async function emitSafe(deps: CrmDeps, e: Parameters<NonNullable<CrmDeps["emit"]>>[0]) {
  try {
    await deps.emit?.(e);
  } catch {
    // Automation never affects lead delivery.
  }
}
