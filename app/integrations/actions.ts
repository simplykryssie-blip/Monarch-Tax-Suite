"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { disconnect, finishPendingInstall, setWebhook, startConnection } from "@/lib/crm/connection.ts";
import { authorizeUrl } from "@/lib/crm/highlevel.ts";
import { crmDeps, licenseFromKey, OAUTH_COOKIE, oauthCookieOptions, oauthRedirectUri, PENDING_COOKIE, pendingCookieOptions } from "@/lib/crm/server";
import { DEFAULT_LEAD_SETTINGS } from "@/lib/crm/types.ts";
import { activateDomain, assertCanEnable, deriveSetupStatus, previewActivation, runConnectionTest, type SetupStatus } from "@/lib/crm/setup.ts";
import { normalizeEmail, ValidationError } from "@/lib/commerce/validation.ts";
import { resolveSetupSession, SETUP_COOKIE } from "@/lib/automation/onboarding.ts";
import { automationDeps, setupSecrets } from "@/lib/automation/server";
import type { License } from "@/lib/commerce/types.ts";

// Buyer self-service for the lead destination. There is no account or
// session: every action is authorized by the license key submitted with it,
// and acts only on that key's license. Responses never include lead data.

export type DestinationView = {
  provider: "highlevel" | "webhook" | null;
  status: string;
  label: string | null;
  lastSuccess: string | null;
  lastError: string | null;
  status_info: SetupStatus;
  domains: string[];
  canEnable: boolean;
  settings: { enabled: boolean; business_name: string; lead_source: string; tags: string; update_existing: boolean; include_summary: boolean };
};
export type SetupState = { ok?: boolean; message?: string; signingSecret?: string; view?: DestinationView; pending?: { domain: string; alsoCovers: string; alreadyActive: boolean } };

const text = (form: FormData, name: string, max: number) => String(form.get(name) ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * The license for this request: a typed key wins; otherwise the signed session from the emailed setup link
 * (re-checked against the stored link on every call, so expiry and revocation take effect immediately).
 */
async function licenseForRequest(form: FormData): Promise<License> {
  const typed = String(form.get("license_key") ?? "").trim();
  if (typed) return licenseFromKey(typed);
  const secrets = setupSecrets();
  const cookie = (await cookies()).get(SETUP_COOKIE)?.value;
  if (secrets && cookie) {
    const deps = automationDeps();
    const session = await resolveSetupSession({ repo: deps.repo, commerce: deps.commerce, secrets }, cookie);
    const license = session ? await deps.commerce.getLicense(session.licenseId) : null;
    if (license && license.status === "active") return license;
  }
  return licenseFromKey(typed);
}

async function view(licenseId: string): Promise<DestinationView> {
  const deps = crmDeps();
  const [c, s, d] = await Promise.all([deps.repo.getLiveConnection(licenseId), deps.repo.getLeadSettings(licenseId), deps.commerce.listDomains(licenseId)]);
  const settings = s ?? DEFAULT_LEAD_SETTINGS(licenseId);
  return {
    provider: c?.provider ?? null,
    status_info: deriveSetupStatus({ connection: c, settings: s }),
    domains: d.filter((x) => x.status === "active").map((x) => x.domain),
    canEnable: Boolean(c && c.status === "connected" && c.last_checked_at && !c.last_error),
    status: !c ? "Not connected" : c.status === "connected" ? "Connected" : "Reauthorization required",
    label: !c ? null : c.provider === "webhook" ? `Webhook to ${c.webhook_host}` : `GoHighLevel: ${c.location_name ?? c.location_id}`,
    lastSuccess: c?.last_success_at ?? null,
    lastError: c?.last_error ?? null,
    settings: { enabled: settings.enabled, business_name: settings.business_name ?? "", lead_source: settings.lead_source, tags: settings.tags.join(", "), update_existing: settings.update_existing, include_summary: settings.include_summary },
  };
}

async function run(form: FormData, fn: (licenseId: string) => Promise<Partial<SetupState>>): Promise<SetupState> {
  try {
    const license = await licenseForRequest(form);
    const result = await fn(license.id);
    return { ok: true, ...result, view: await view(license.id) };
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, message: e.message };
    throw e;
  }
}

/** Step 1. First submit shows the domain to be authorized; the customer must confirm before anything changes. */
export async function activateAction(_prev: SetupState, form: FormData): Promise<SetupState> {
  try {
    const license = await licenseForRequest(form);
    const commerce = crmDeps().commerce;
    const raw = String(form.get("domain") ?? "");
    if (form.get("confirm") !== "yes") {
      const pending = await previewActivation(commerce, license.id, raw);
      return { ok: true, pending, view: await view(license.id) };
    }
    const done = await activateDomain(commerce, license.id, raw);
    return { ok: true, message: done.alreadyActive ? `${done.domain} was already activated.` : `Activated. Your calculator can now appear on ${done.domain} and www.${done.domain}.`, view: await view(license.id) };
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, message: e.message };
    throw e;
  }
}

export async function lookupAction(_prev: SetupState, form: FormData): Promise<SetupState> {
  return run(form, async () => ({}));
}

export async function setWebhookAction(_prev: SetupState, form: FormData): Promise<SetupState> {
  return run(form, async (licenseId) => {
    const { signingSecret } = await setWebhook(crmDeps(), licenseId, String(form.get("webhook_url") ?? ""));
    return { message: "Webhook saved. Copy the signing secret now; it is shown only once.", signingSecret };
  });
}

export async function testAction(_prev: SetupState, form: FormData): Promise<SetupState> {
  return run(form, async (licenseId) => {
    const raw = String(form.get("test_email") ?? "").trim();
    const result = await runConnectionTest(crmDeps(), licenseId, { email: raw ? normalizeEmail(raw) : undefined });
    if (!result.ok) throw new ValidationError(result.message);
    return { message: result.message };
  });
}

export async function disconnectAction(_prev: SetupState, form: FormData): Promise<SetupState> {
  return run(form, async (licenseId) => {
    const done = await disconnect(crmDeps(), licenseId);
    return { message: done ? "Disconnected. Monarch deleted the stored credentials and turned the lead form off." : "No destination was connected." };
  });
}

export async function saveSettingsAction(_prev: SetupState, form: FormData): Promise<SetupState> {
  return run(form, async (licenseId) => {
    const deps = crmDeps();
    const enabled = form.get("enabled") === "on";
    const business = text(form, "business_name", 120);
    const tags = [...new Set(text(form, "tags", 500).split(",").map((t) => t.trim().toLowerCase()).filter(Boolean))];
    if (tags.length > 10 || tags.some((t) => t.length > 40)) throw new ValidationError("Use at most 10 tags, each 40 characters or fewer.");
    if (enabled) {
      const c = await deps.repo.getLiveConnection(licenseId);
      assertCanEnable(c, Boolean((await deps.repo.getLeadSettings(licenseId))?.enabled));
      if (!business) throw new ValidationError("Enter your business name; visitors see it in the consent statement.");
    }
    await deps.repo.saveLeadSettings({ license_id: licenseId, enabled, business_name: business || null, lead_source: text(form, "lead_source", 80) || "Monarch Tax Calculator", tags, update_existing: form.get("update_existing") === "on", include_summary: form.get("include_summary") === "on" });
    return { message: enabled ? "Saved. The lead form now appears on your calculator." : "Saved. The lead form is off." };
  });
}

/** Starts GoHighLevel OAuth for the license; the state is bound to this browser by an HttpOnly cookie. */
export async function connectHighLevelAction(_prev: SetupState, form: FormData): Promise<SetupState> {
  let target: string;
  try {
    const license = await licenseForRequest(form);
    const state = await startConnection(crmDeps(), license.id);
    (await cookies()).set(OAUTH_COOKIE, state, oauthCookieOptions);
    target = authorizeUrl(process.env.HIGHLEVEL_CLIENT_ID!, await oauthRedirectUri(), state, process.env.HIGHLEVEL_VERSION_ID || undefined);
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, message: e.message };
    throw e;
  }
  redirect(target);
}

/** Finishes an install that was started inside GoHighLevel: the license holder's key binds it to their license. */
export async function finishInstallAction(_prev: SetupState, form: FormData): Promise<SetupState> {
  try {
    const license = await licenseForRequest(form);
    const jar = await cookies();
    const connection = await finishPendingInstall(crmDeps(), { sealed: jar.get(PENDING_COOKIE)?.value, licenseId: license.id });
    jar.set(PENDING_COOKIE, "", { ...pendingCookieOptions, maxAge: 0 });
    return { ok: true, message: `GoHighLevel connected to ${connection.location_name ?? connection.location_id}. Now test the connection.`, view: await view(license.id) };
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, message: e.message };
    throw e;
  }
}
