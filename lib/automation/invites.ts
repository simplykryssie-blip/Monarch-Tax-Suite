import { ValidationError } from "../commerce/validation.ts";
import { emitEvent, type AutomationDeps } from "./engine.ts";

// Asking for a (new) setup email. Used by administrators and, through a form that never reveals whether an
// address is registered, by customers whose link expired.

const WINDOW_MS = 3_600_000;
const MAX_PER_LICENSE_PER_HOUR = 3;

export type InviteResult = { sent: boolean; reason?: "throttled" | "already_requested" };

const since = (deps: AutomationDeps) => new Date((deps.now?.() ?? new Date()).getTime() - WINDOW_MS).toISOString();

/** Raises one fresh invitation for a license. The old link keeps working until the new email is actually delivered. */
export async function requestInvite(deps: AutomationDeps, licenseId: string, by: { adminId: string | null }): Promise<InviteResult> {
  const license = await deps.commerce.getLicense(licenseId);
  if (!license) throw new ValidationError("License not found.");
  if (license.status === "revoked") throw new ValidationError("This license is revoked, so no setup email is sent.");
  const recent = await deps.repo.listEventsByLicense(licenseId, 20);
  if (recent.filter((e) => e.event_type === "onboarding.invite_requested" && e.created_at >= since(deps)).length >= MAX_PER_LICENSE_PER_HOUR) return { sent: false, reason: "throttled" };
  // One fresh-link email per setup link: the key names the license's newest link. A double-click, or an
  // administrator and the customer asking at the same moment, produce the same key and so one email. Once a new
  // email goes out it carries a new link, so the next genuine request gets a new key. A request whose email
  // failed before a link was made does not block the next one.
  const [latest] = await deps.repo.listLinksForLicense(licenseId, 1);
  const base = `invite:${licenseId}:after:${latest?.id ?? "none"}`;
  const prior = recent.filter((e) => e.event_key === base || e.event_key.startsWith(`${base}:`));
  if (prior.length) {
    const runs = await deps.repo.listExecutionsForEvents(prior.map((e) => e.id));
    if (runs.some((r) => !r.is_test && r.status !== "failed" && r.status !== "skipped")) return { sent: false, reason: "already_requested" };
  }
  const { duplicate } = await emitEvent(deps, {
    type: "onboarding.invite_requested",
    key: prior.length ? `${base}:${prior.length}` : base,
    licenseId,
    customerId: license.customer_id,
    data: { source: by.adminId ? "admin" : "customer" },
  });
  if (duplicate) return { sent: false, reason: "already_requested" };
  await deps.repo.addAudit({ actor_id: by.adminId, action: by.adminId ? "setup_email_resent" : "setup_email_requested_by_customer", target_type: "license", target_id: licenseId, detail: {} });
  return { sent: true };
}

/**
 * Customer self-service: "email me a new link". The caller always shows the same message, so this cannot be used
 * to discover which addresses are customers. The email goes only to the address already on the license.
 */
export async function requestInviteByEmail(deps: AutomationDeps, rawEmail: string): Promise<void> {
  const email = rawEmail.trim().toLowerCase();
  if (!/^[^\s@]{1,64}@[^\s@]{1,255}$/.test(email)) return;
  const customer = await deps.commerce.findCustomerByEmail(email);
  if (!customer) return;
  const licenses = (await deps.commerce.listLicenses()).filter((l) => l.customer_id === customer.id && l.status !== "revoked");
  for (const l of licenses.slice(0, 3)) {
    try {
      await requestInvite(deps, l.id, { adminId: null });
    } catch {
      // Never reveal failures to the visitor.
    }
  }
}
