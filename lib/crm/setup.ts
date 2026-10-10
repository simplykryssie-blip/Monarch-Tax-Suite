import { authorizeDomain } from "../commerce/fulfillment.ts";
import type { CommerceRepo } from "../commerce/types.ts";
import { normalizeDomain, ValidationError } from "../commerce/validation.ts";
import { nowOf, requireHighLevel, testDestination, withAccessToken, type CrmDeps } from "./connection.ts";
import { HighLevelError } from "./highlevel.ts";
import type { CrmConnection, LeadSettings } from "./types.ts";

// Customer-facing setup logic for the three-step wizard (activate, connect,
// test and enable). Everything here takes a license id the server resolved
// itself from the customer's license key; nothing trusts a browser-supplied id.

/** Shared addresses that many unrelated sites use. Authorizing one would let every site on it show the calculator. */
const SHARED_HOST_SUFFIXES = [
  "vercel.app", "netlify.app", "pages.dev", "github.io", "herokuapp.com", "onrender.com",
  "myshopify.com", "wixsite.com", "weebly.com", "squarespace.com", "webflow.io", "carrd.co",
  "gohighlevel.com", "leadconnectorhq.com", "msgsndr.com", "highlevel.com", "clickfunnels.com", "jotform.com",
];

/** Turns whatever the customer typed (a page URL, a www address) into the main domain to authorize. */
export function normalizeMainDomain(input: string): string {
  const scheme = input.trim().match(/^([a-z][a-z0-9+.-]*):\/\//i)?.[1]?.toLowerCase();
  if (scheme && scheme !== "http" && scheme !== "https") throw new ValidationError("Enter your website address without anything before it, such as yourbusiness.com.");
  const host = normalizeDomain(input);
  if (SHARED_HOST_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`))) {
    throw new ValidationError("That is a shared address used by many websites. Enter your own website address, such as yourbusiness.com.");
  }
  const parts = host.replace(/^www\./, "");
  if (!parts.includes(".")) throw new ValidationError("Enter your main website address, such as yourbusiness.com.");
  return parts;
}

export type ActivationPreview = { domain: string; alsoCovers: string; alreadyActive: boolean };

/** What would be authorized, without changing anything. Fails with a plain message when the license cannot take another domain. */
export async function previewActivation(commerce: CommerceRepo, licenseId: string, rawDomain: string): Promise<ActivationPreview> {
  const license = await commerce.getLicense(licenseId);
  if (!license || license.status !== "active") throw new ValidationError("An active calculator license is required.");
  const domain = normalizeMainDomain(rawDomain);
  const twin = `www.${domain}`;
  const active = (await commerce.listDomains(license.id)).filter((d) => d.status === "active");
  const alreadyActive = active.some((d) => d.domain === domain || d.domain === twin);
  if (!alreadyActive) {
    const holders = (await commerce.findActiveDomainHolders([domain, twin])).filter((id) => id !== license.id);
    // Deliberately vague: do not reveal who holds the domain.
    if (holders.length) throw new ValidationError("That website address is already registered to another Monarch Tax Suite license. If it is yours, contact Monarch Tax Suite so we can sort it out.");
  }
  if (!alreadyActive && active.length >= license.max_domains) {
    throw new ValidationError(`This license is already activated for ${active.map((d) => d.domain).join(", ")}. Contact Monarch Tax Suite to change your website.`);
  }
  return { domain, alsoCovers: twin, alreadyActive };
}

/** Authorizes the confirmed domain. The license key is the customer's proof of ownership; the existing domain rules and limits still apply. */
export async function activateDomain(commerce: CommerceRepo, licenseId: string, rawDomain: string) {
  const preview = await previewActivation(commerce, licenseId, rawDomain);
  if (preview.alreadyActive) return preview;
  await authorizeDomain(commerce, licenseId, preview.domain, null);
  return preview;
}

// ------------------------------------------------------------------- status

export type SetupStatusKey = "not_connected" | "reauth_needed" | "connected" | "test_failed" | "test_successful" | "lead_capture_enabled";
export type SetupStatus = { key: SetupStatusKey; label: string; detail: string };

type StatusInput = { connection: Pick<CrmConnection, "provider" | "status" | "last_checked_at" | "last_error"> | null; settings: Pick<LeadSettings, "enabled"> | null };

/** True only after a test has passed on the current destination and nothing has failed since. */
export function hasPassedTest(connection: StatusInput["connection"]): boolean {
  return Boolean(connection && connection.status === "connected" && connection.last_checked_at && !connection.last_error);
}

/** The customer-visible state. "Success" is never shown just because a destination was saved. */
export function deriveSetupStatus({ connection, settings }: StatusInput): SetupStatus {
  if (!connection || connection.status === "disconnected") return { key: "not_connected", label: "Not connected", detail: "Connect your CRM so leads have somewhere to go." };
  if (connection.status === "reauth_required") return { key: "reauth_needed", label: "Test failed", detail: "GoHighLevel needs you to reconnect. Your access expired or was removed." };
  if (connection.last_error) return { key: "test_failed", label: "Test failed", detail: "We couldn't reach your CRM. Fix the problem below, then test again." };
  if (!connection.last_checked_at) {
    return { key: "connected", label: "Connected, not tested yet", detail: "Run the test to make sure leads will arrive before you turn on lead capture." };
  }
  if (settings?.enabled) return { key: "lead_capture_enabled", label: "Lead capture enabled", detail: "Your calculator is ready to collect leads." };
  return { key: "test_successful", label: "Test successful", detail: "Everything checked out. Turn on lead capture to start collecting leads." };
}

// --------------------------------------------------------------------- test

const TEST_TAG = "monarch-test";
const TEST_EMAIL = "monarch-connection-test@example.com";

export type TestOutcome = { ok: boolean; message: string };

/**
 * One "Test connection" action.
 *  - GoHighLevel: checks the connection and the chosen location, then creates (or finds) a single
 *    clearly labelled test contact in the customer's own location. No email or text is sent.
 *  - Webhook: delivers a test event that contains no lead data. We can confirm the address
 *    accepted it, not what the customer's workflow does with it.
 */
export async function runConnectionTest(deps: CrmDeps, licenseId: string, opts: { email?: string } = {}): Promise<TestOutcome> {
  const testEmail = opts.email || TEST_EMAIL;
  const connection = await deps.repo.getLiveConnection(licenseId);
  if (!connection) return { ok: false, message: "Connect your CRM first." };
  if (connection.provider === "webhook") {
    const result = await testDestination(deps, licenseId, { sample: true, email: opts.email });
    return result.ok
      ? { ok: true, message: `${result.message} We can confirm your address received the test. Check your CRM to see that your own automation handled it.` }
      : { ok: false, message: result.message };
  }
  if (connection.status === "reauth_required") return { ok: false, message: "GoHighLevel needs you to reconnect first." };
  const now = () => nowOf(deps).toISOString();
  try {
    const { api } = requireHighLevel(deps);
    const settings = await deps.repo.getLeadSettings(licenseId);
    const outcome = await withAccessToken(deps, connection, async (token, c) => {
      const location = await api.getLocation(token, c.location_id!);
      let id = await api.findDuplicate(token, c.location_id!, { email: testEmail });
      const created = !id;
      if (!id) id = await api.createContact(token, { locationId: c.location_id!, firstName: "Monarch", lastName: "Connection Test", email: testEmail, source: settings?.lead_source || "Monarch Tax Calculator" });
      await api.addTags(token, id, [TEST_TAG]);
      return { name: location.name, created };
    });
    await deps.repo.updateConnection(connection.id, { location_name: outcome.name ?? connection.location_name, last_checked_at: now(), last_error: null });
    return {
      ok: true,
      message: `Connected to ${outcome.name ?? "your GoHighLevel account"}. ${outcome.created ? "We added" : "We found"} a contact named "Monarch Connection Test" (tag: ${TEST_TAG}) there. You can delete it. No email or text was sent.`,
    };
  } catch (e) {
    const auth = e instanceof HighLevelError && e.kind === "auth";
    await deps.repo.updateConnection(connection.id, { last_checked_at: now(), last_error: auth ? "GoHighLevel access expired or was removed." : "GoHighLevel did not accept the test.", last_error_at: now() }).catch(() => undefined);
    return {
      ok: false,
      message: auth
        ? "GoHighLevel access expired or was removed. Choose Reconnect GoHighLevel and approve access again."
        : "We couldn't add the test contact in GoHighLevel. Check that you approved all the requested permissions and try again.",
    };
  }
}

/** Lead capture may be turned on only after a passed test. Turning it off, or leaving it on, is always allowed. */
export function assertCanEnable(connection: CrmConnection | null, alreadyEnabled: boolean) {
  if (!connection || connection.status !== "connected") throw new ValidationError("Connect your CRM before turning on lead capture.");
  if (alreadyEnabled) return;
  if (!hasPassedTest(connection)) throw new ValidationError("Run Test connection first. Lead capture can be turned on once the test passes.");
}
