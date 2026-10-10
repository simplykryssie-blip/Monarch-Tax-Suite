import { ValidationError } from "../commerce/validation.ts";
import { emitEvent, type AutomationDeps } from "./engine.ts";

// Asking for a (new) setup email. Used by administrators and, through a form that never reveals whether an
// address is registered, by customers whose link expired.

const WINDOW_MS = 3_600_000;
const MAX_PER_LICENSE_PER_HOUR = 3;

export type InviteResult = { sent: boolean; reason?: "throttled" };

async function recentInvites(deps: AutomationDeps, licenseId: string) {
  const since = new Date((deps.now?.() ?? new Date()).getTime() - WINDOW_MS).toISOString();
  return (await deps.repo.listEventsByLicense(licenseId, 20)).filter((e) => e.event_type === "onboarding.invite_requested" && e.created_at >= since).length;
}

/** Raises one fresh invitation for a license. The old link keeps working until the new email is actually delivered. */
export async function requestInvite(deps: AutomationDeps, licenseId: string, by: { adminId: string | null }): Promise<InviteResult> {
  const license = await deps.commerce.getLicense(licenseId);
  if (!license) throw new ValidationError("License not found.");
  if (license.status === "revoked") throw new ValidationError("This license is revoked, so no setup email is sent.");
  if ((await recentInvites(deps, licenseId)) >= MAX_PER_LICENSE_PER_HOUR) return { sent: false, reason: "throttled" };
  const at = deps.now?.() ?? new Date();
  await emitEvent(deps, {
    type: "onboarding.invite_requested",
    key: `invite:${licenseId}:${at.getTime()}`,
    licenseId,
    customerId: license.customer_id,
    data: { source: by.adminId ? "admin" : "customer" },
  });
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
