"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { disconnect, setWebhook, startConnection, testDestination } from "@/lib/crm/connection.ts";
import { authorizeUrl } from "@/lib/crm/highlevel.ts";
import { crmDeps, licenseFromKey, OAUTH_COOKIE, oauthCookieOptions, oauthRedirectUri } from "@/lib/crm/server";
import { DEFAULT_LEAD_SETTINGS } from "@/lib/crm/types.ts";
import { ValidationError } from "@/lib/commerce/validation.ts";

// Buyer self-service for the lead destination. There is no account or
// session: every action is authorized by the license key submitted with it,
// and acts only on that key's license. Responses never include lead data.

export type DestinationView = {
  provider: "highlevel" | "webhook" | null;
  status: string;
  label: string | null;
  lastSuccess: string | null;
  lastError: string | null;
  settings: { enabled: boolean; business_name: string; lead_source: string; tags: string; update_existing: boolean; include_summary: boolean };
};
export type SetupState = { ok?: boolean; message?: string; signingSecret?: string; view?: DestinationView };

const text = (form: FormData, name: string, max: number) => String(form.get(name) ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

async function view(licenseId: string): Promise<DestinationView> {
  const deps = crmDeps();
  const [c, s] = await Promise.all([deps.repo.getLiveConnection(licenseId), deps.repo.getLeadSettings(licenseId)]);
  const settings = s ?? DEFAULT_LEAD_SETTINGS(licenseId);
  return {
    provider: c?.provider ?? null,
    status: !c ? "Not connected" : c.status === "connected" ? "Connected" : "Reauthorization required",
    label: !c ? null : c.provider === "webhook" ? `Webhook to ${c.webhook_host}` : `GoHighLevel: ${c.location_name ?? c.location_id}`,
    lastSuccess: c?.last_success_at ?? null,
    lastError: c?.last_error ?? null,
    settings: { enabled: settings.enabled, business_name: settings.business_name ?? "", lead_source: settings.lead_source, tags: settings.tags.join(", "), update_existing: settings.update_existing, include_summary: settings.include_summary },
  };
}

async function run(form: FormData, fn: (licenseId: string) => Promise<Partial<SetupState>>): Promise<SetupState> {
  try {
    const license = await licenseFromKey(String(form.get("license_key") ?? ""));
    const result = await fn(license.id);
    return { ok: true, ...result, view: await view(license.id) };
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
    const result = await testDestination(crmDeps(), licenseId);
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
      if (!c || c.status !== "connected") throw new ValidationError("Connect GoHighLevel or a webhook before turning on the lead form.");
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
    const license = await licenseFromKey(String(form.get("license_key") ?? ""));
    const state = await startConnection(crmDeps(), license.id);
    (await cookies()).set(OAUTH_COOKIE, state, oauthCookieOptions);
    target = authorizeUrl(process.env.HIGHLEVEL_CLIENT_ID!, await oauthRedirectUri(), state);
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, message: e.message };
    throw e;
  }
  redirect(target);
}
