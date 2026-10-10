import { normalizeEmail, ValidationError } from "../commerce/validation.ts";
import type { AuthorizedDomain, License } from "../commerce/types.ts";
import type { AutomationEvent, Execution, OnboardingLink, OnboardingProfile } from "./types.ts";

// Onboarding progress: what the customer has finished, what is left, and the single status the admin sees.
// Pure functions over records the app already holds, so the wizard and the admin page can never disagree.

export type OnboardingStatus = "not_started" | "invitation_sent" | "in_progress" | "awaiting_crm" | "ready_to_install" | "completed" | "needs_attention";

export const STATUS_LABELS: Record<OnboardingStatus, string> = {
  not_started: "Not started",
  invitation_sent: "Invitation sent",
  in_progress: "In progress",
  awaiting_crm: "Awaiting CRM connection",
  ready_to_install: "Ready to install",
  completed: "Completed",
  needs_attention: "Needs attention",
};

export type ConnectionFacts = { provider: "highlevel" | "webhook"; status: string; last_checked_at: string | null; last_error: string | null } | null;

/** True only after a test passed on the current destination and nothing has failed since. */
export const connectionVerified = (c: ConnectionFacts) => Boolean(c && c.status === "connected" && c.last_checked_at && !c.last_error);

export type Step = { key: "details" | "domain" | "crm" | "test"; label: string; done: boolean; hint: string };

export function stepsFor(input: { profile: OnboardingProfile | null; domains: Pick<AuthorizedDomain, "status">[]; connection: ConnectionFacts }): Step[] {
  const p = input.profile;
  const details = Boolean(p?.contact_name && p.business_name && p.business_email);
  const domain = input.domains.some((d) => d.status === "active");
  const crm = Boolean(input.connection && input.connection.status === "connected");
  return [
    { key: "details", label: "Business details", done: details, hint: "Enter your name, business name and email." },
    { key: "domain", label: "Website authorized", done: domain, hint: "Enter and confirm your website address." },
    { key: "crm", label: "CRM connected", done: crm, hint: "Connect GoHighLevel, or paste a workflow link." },
    { key: "test", label: "Connection tested", done: connectionVerified(input.connection), hint: "Press Test connection and fix any problem it reports." },
  ];
}

export type InviteFacts = { status: "none" | "sent" | "sending" | "failed"; at: string | null; error: string | null; messageId: string | null; linkOpenedAt: string | null; linkState: "none" | "active" | "expired" | "revoked" };

const INVITE_EVENTS = new Set(["license.manual_created", "license.paid_created", "onboarding.invite_requested"]);

/** The latest setup-email outcome, from the events and runs the Automation Center already records. */
export function inviteFacts(events: AutomationEvent[], executions: Execution[], links: OnboardingLink[], nowMs: number): InviteFacts {
  const invites = events.filter((e) => INVITE_EVENTS.has(e.event_type)).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const latest = invites[0];
  const runs = latest ? executions.filter((x) => x.event_id === latest.id && !x.is_test) : [];
  const mail = runs.find((x) => x.action_log.some((a) => a.type === "send_email")) ?? runs[0];
  const sent = mail?.action_log.find((a) => a.type === "send_email" && a.status === "ok");
  const status: InviteFacts["status"] = !latest ? "none" : !mail ? "failed" : sent ? "sent" : mail.status === "failed" || mail.status === "skipped" ? "failed" : "sending";
  const newest = [...links].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const opened = links.map((l) => l.first_opened_at).filter((x): x is string => Boolean(x)).sort()[0] ?? null;
  const linkState: InviteFacts["linkState"] = !newest ? "none" : newest.revoked_at ? "revoked" : Date.parse(newest.expires_at) <= nowMs ? "expired" : "active";
  return { status, at: mail?.finished_at ?? mail?.created_at ?? latest?.created_at ?? null, error: status === "failed" ? mail?.error ?? (!mail ? "No workflow sent the setup email. Check that the onboarding workflow is turned on." : null) : null, messageId: sent?.message_id ?? null, linkOpenedAt: opened, linkState };
}

export type Progress = { status: OnboardingStatus; steps: Step[]; remaining: Step[]; attention: string[]; lastActivity: string | null };

export function deriveProgress(input: {
  license: Pick<License, "status">;
  profile: OnboardingProfile | null;
  domains: Pick<AuthorizedDomain, "status">[];
  connection: ConnectionFacts;
  invite: InviteFacts;
}): Progress {
  const steps = stepsFor(input);
  const remaining = steps.filter((s) => !s.done);
  const attention: string[] = [];
  if (input.invite.status === "failed") attention.push(`The setup email could not be sent: ${input.invite.error ?? "unknown reason"}`);
  if (input.connection?.status === "reauth_required") attention.push("GoHighLevel needs to be reconnected.");
  else if (input.connection?.last_error) attention.push(`The last CRM test or delivery failed: ${input.connection.last_error}`);
  if (input.license.status !== "active" && input.license.status !== "pending") attention.push(`The license is ${input.license.status}.`);
  const activity = [input.profile?.last_activity_at, input.invite.linkOpenedAt, input.invite.at].filter((x): x is string => Boolean(x)).sort().pop() ?? null;

  let status: OnboardingStatus;
  if (input.profile?.completed_at) status = "completed";
  else if (attention.length) status = "needs_attention";
  else if (remaining.length === 0) status = "ready_to_install";
  else if (steps[0].done && steps[1].done) status = "awaiting_crm";
  else if (input.invite.linkOpenedAt || steps.some((s) => s.done)) status = "in_progress";
  else if (input.invite.status === "sent" || input.invite.status === "sending") status = "invitation_sent";
  else status = "not_started";
  return { status, steps, remaining, attention, lastActivity: activity };
}

// ------------------------------------------------------------- customer input

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");

export function validateProfileInput(input: { contact_name: unknown; business_name: unknown; business_email: unknown; phone?: unknown; ghl_account?: unknown }) {
  const contact_name = clean(input.contact_name, 120);
  const business_name = clean(input.business_name, 120);
  if (contact_name.length < 2) throw new ValidationError("Enter your full name.");
  if (business_name.length < 2) throw new ValidationError("Enter your business name.");
  let business_email: string;
  try {
    business_email = normalizeEmail(clean(input.business_email, 254));
  } catch {
    throw new ValidationError("Enter a valid business email address.");
  }
  const phone = clean(input.phone, 40);
  if (phone && !/^[0-9+().\-\s]{7,40}$/.test(phone)) throw new ValidationError("Enter a phone number using digits only (or leave it blank).");
  return { contact_name, business_name, business_email, phone: phone || null, ghl_account: clean(input.ghl_account, 120) || null };
}

// ---------------------------------------------------------------- completion

export type CompletionResult = { ok: true; alreadyCompleted: boolean } | { ok: false; remaining: Step[] };

/** Marks onboarding complete only when every step is genuinely done. Idempotent: a second call changes nothing. */
export async function completeOnboarding(
  repo: { getProfile(id: string): Promise<OnboardingProfile | null>; completeProfile(id: string, nowIso: string): Promise<boolean> },
  facts: { license: Pick<License, "id" | "status">; domains: Pick<AuthorizedDomain, "status">[]; connection: ConnectionFacts },
  nowIso: string,
): Promise<CompletionResult> {
  const profile = await repo.getProfile(facts.license.id);
  if (profile?.completed_at) return { ok: true, alreadyCompleted: true };
  const remaining = stepsFor({ profile, domains: facts.domains, connection: facts.connection }).filter((s) => !s.done);
  if (facts.license.status !== "active") throw new ValidationError("Your license is not active yet, so setup cannot be finished.");
  if (remaining.length) return { ok: false, remaining };
  const won = await repo.completeProfile(facts.license.id, nowIso);
  return { ok: true, alreadyCompleted: !won };
}
