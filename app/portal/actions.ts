"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { disconnect, testConnection } from "@/lib/crm/connection.ts";
import { processDueLeads } from "@/lib/crm/leads.ts";
import { crmDeps, endPortalSession, requirePortalLicense, startPortalSession } from "@/lib/crm/server";
import { ValidationError } from "@/lib/commerce/validation.ts";

// Buyer portal actions. Every action resolves the license from the signed,
// HttpOnly portal session; no license, customer or location id is accepted
// from the browser. Server Actions also reject cross-site requests.

export type PortalState = { ok?: boolean; message?: string };

async function run(fn: () => Promise<string>): Promise<PortalState> {
  try {
    const message = await fn();
    revalidatePath("/portal");
    return { ok: true, message };
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, message: e.message };
    throw e;
  }
}

export async function portalSignInAction(_prev: PortalState, form: FormData): Promise<PortalState> {
  try {
    await startPortalSession(String(form.get("license_key") ?? ""));
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, message: e.message };
    throw e;
  }
  redirect("/portal");
}

export async function portalSignOutAction() {
  await endPortalSession();
  redirect("/portal");
}

const text = (form: FormData, name: string, max: number) => String(form.get(name) ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

export async function saveLeadSettingsAction(_prev: PortalState, form: FormData): Promise<PortalState> {
  return run(async () => {
    const license = await requirePortalLicense();
    const deps = crmDeps();
    const enabled = form.get("enabled") === "on";
    const businessName = text(form, "business_name", 120);
    const tags = [...new Set(text(form, "tags", 500).split(",").map((t) => t.trim().toLowerCase()).filter(Boolean))];
    if (tags.length > 10 || tags.some((t) => t.length > 40)) throw new ValidationError("Use at most 10 tags, each 40 characters or fewer.");
    if (enabled) {
      if (license.status !== "active") throw new ValidationError("Your license is not active, so lead capture cannot be turned on.");
      const connection = await deps.repo.getLiveConnection(license.id);
      if (!connection || connection.status !== "connected") throw new ValidationError("Connect GoHighLevel successfully before turning on lead capture.");
      if (!businessName) throw new ValidationError("Enter your business name; visitors see it on the consent statement.");
    }
    await deps.repo.saveLeadSettings({
      license_id: license.id,
      enabled,
      business_name: businessName || null,
      lead_source: text(form, "lead_source", 80) || "Monarch Tax Calculator",
      tags,
      update_existing: form.get("update_existing") === "on",
      include_summary: form.get("include_summary") === "on",
    });
    return enabled ? "Saved. The lead form now appears on your calculator." : "Saved. Lead capture is off; the calculator shows no lead form.";
  });
}

export async function testConnectionAction(): Promise<PortalState> {
  const license = await requirePortalLicense().catch(() => null);
  if (!license) return { ok: false, message: "Your portal session expired. Sign in again." };
  try {
    const result = await testConnection(crmDeps(), license.id);
    revalidatePath("/portal");
    return result;
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, message: e.message };
    throw e;
  }
}

export async function disconnectAction(): Promise<PortalState> {
  return run(async () => {
    const license = await requirePortalLicense();
    const done = await disconnect(crmDeps(), license.id);
    return done
      ? "Disconnected. Monarch deleted its stored GoHighLevel credentials and lead capture is off. To remove the app from your sub-account as well, uninstall it in GoHighLevel."
      : "GoHighLevel was not connected.";
  });
}

/** Re-queues this buyer's undelivered leads (still within retention) and delivers them now. */
export async function retryLeadsAction(): Promise<PortalState> {
  return run(async () => {
    const license = await requirePortalLicense();
    const deps = crmDeps();
    const connection = await deps.repo.getLiveConnection(license.id);
    if (!connection || connection.status !== "connected") throw new ValidationError("Connect (or reconnect) GoHighLevel first.");
    const pending = await deps.repo.listLeadsByStatus(license.id, ["retry_pending", "failed"]);
    let count = 0;
    for (const lead of pending) {
      if (!lead.payload_enc) continue;
      await deps.repo.updateLead(lead.id, { status: "retry_pending", attempts: 0, next_attempt_at: new Date().toISOString(), last_error: null });
      count++;
    }
    after(() => processDueLeads(deps, { licenseId: license.id, limit: 50 }));
    return count ? `Retrying ${count} lead${count === 1 ? "" : "s"}. Refresh in a moment to see the result.` : "No undelivered leads to retry.";
  });
}
