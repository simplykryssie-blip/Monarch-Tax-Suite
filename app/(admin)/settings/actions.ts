"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { automationDeps } from "@/lib/automation/server";
import { emailConfig } from "@/lib/automation/email.ts";
import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { addSender, AlreadyRegisteredError, cleanAttribute, removeDomain, cleanDomain, cleanFromName, cleanLocalPart, ResendDomains } from "@/lib/automation/senders.ts";
import { randomUUID } from "node:crypto";
import { appOrigin, imageStore } from "@/lib/admin";
import { mediaPathFromUrl } from "@/lib/storage/paths.ts";
import { validateImage } from "@/lib/commerce/images.ts";
import { BrandError, checkBrand } from "@/lib/branding/brand.ts";
import { brandRepo } from "@/lib/branding/server";
import { formDeps } from "@/lib/forms/server";
import { readSettings } from "@/lib/forms/settings.ts";
import { documentDeps } from "@/lib/documents/server";
import { cleanLinkHost, defaultLinkHost } from "@/lib/brands.ts";
import { currentTenantId, MONARCH_TENANT_ID } from "@/lib/tenants.ts";
import { advanceRegistration, chooseNumber, provision, saveSetupChoices, startCreditsCheckout, startSetupCheckout } from "@/lib/sms/service.ts";
import { smsPayments, smsSetupDeps } from "@/lib/sms/server";

// Firm profile, sending domains and senders, and package attributes for the current tenant. Every action re-checks
// administrator access; the tenant-scoped client means only this tenant's rows can be read or changed.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const str = (form: FormData, k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string) : "");
const withParam = (path: string, key: "notice" | "error", message: string) => `${path}?${key}=${encodeURIComponent(message)}`;

async function act(back: string, fn: (adminId: string) => Promise<string>) {
  const admin = await requireAdmin();
  let target: string;
  try {
    target = withParam(back, "notice", await fn(admin.userId));
  } catch (e) {
    if (e instanceof ValidationError) target = withParam(back, "error", e.message);
    else {
      const msg = e instanceof Error ? e.message : "";
      console.error(`settings action failed: ${sanitizeError(e, 200)}`);
      target = withParam(back, "error", /duplicate key|unique/i.test(msg) ? "That already exists." : /relation|schema cache|does not exist/i.test(msg) ? "These settings are not installed yet. Apply the documents migration first." : "That did not work. Nothing was changed. Please try again.");
    }
  }
  revalidatePath("/settings", "layout");
  redirect(target);
}

const domains = () => { const c = emailConfig(process.env); return new ResendDomains(c.apiKey, fetch, c.keySource); };

export async function saveFirmProfileAction(form: FormData) {
  await act("/settings/firm", async (adminId) => {
    const legal = str(form, "legal_name").replace(/\s+/g, " ").trim().slice(0, 200);
    const display = str(form, "display_name").replace(/\s+/g, " ").trim().slice(0, 120);
    const email = str(form, "email").trim().toLowerCase();
    const tz = str(form, "time_zone").trim();
    if (legal.length < 2 || display.length < 2) throw new ValidationError("Enter the firm's legal name and the name clients see.");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError("Enter a valid email address.");
    try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); } catch { throw new ValidationError("Choose a valid time zone."); }
    await documentDeps().repo.saveProfile(currentTenantId(), {
      legal_name: legal, display_name: display, email: email || null, phone: str(form, "phone").trim().slice(0, 40) || null,
      address: str(form, "address").replace(/\r\n/g, "\n").trim().slice(0, 400) || null, time_zone: tz, updated_by: adminId,
    });
    return "Firm profile saved.";
  });
}

export async function connectDomainAction(form: FormData) {
  await act("/settings/email", async (adminId) => {
    const domain = cleanDomain(str(form, "domain"));
    const repo = automationDeps().senders!;
    if ((await repo.listDomains()).some((d) => d.domain === domain)) throw new ValidationError("That domain is already connected.");
    const api = domains();
    let created;
    try {
      created = await api.create(domain);
    } catch (e) {
      // Only the platform's own tenant may take over a domain already registered on the platform's provider account
      // (for example Monarch's existing sending domain). Anyone else must verify their own domain through DNS.
      if (!(e instanceof AlreadyRegisteredError) || currentTenantId() !== MONARCH_TENANT_ID) throw e;
      created = await api.findByName(domain);
      if (!created) throw e;
    }
    const row = await repo.insertDomain({ domain, provider_domain_id: created.id, status: created.status, dns_records: created.records, created_by: adminId });
    // The form web address is set for them: forms.<their domain>. They can change it, but never have to invent it.
    const host = defaultLinkHost(domain);
    await repo.updateDomain(row.id, { link_host: host });
    return `${domain} added. Add the DNS records shown below at your domain host, then press Check. Form links will use https://${host}.`;
  });
}

export async function checkDomainAction(form: FormData) {
  await act("/settings/email", async () => {
    const id = str(form, "id");
    if (!UUID.test(id)) throw new ValidationError("Not found.");
    const repo = automationDeps().senders!;
    const row = await repo.getDomain(id);
    if (!row?.provider_domain_id) throw new ValidationError("Not found.");
    const api = domains();
    if (row.status !== "verified") await api.verify(row.provider_domain_id).catch(() => undefined);
    const now = await api.get(row.provider_domain_id);
    await repo.updateDomain(id, { status: now.status, dns_records: now.records, last_checked_at: new Date().toISOString() });
    return now.status === "verified" ? `${row.domain} is verified. You can send from it.` : `${row.domain} is not verified yet. DNS changes can take a few hours; check again later.`;
  });
}

const BRAND_EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;

/** Stores a brand logo in the account's own private storage; returns the full https address emails and pages show it at. */
async function uploadBrandImage(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { type } = validateImage({ bytes, declaredType: file.type, fileName: file.name, altText: null });
  const store = imageStore(await appOrigin());
  const path = `images/brands/${randomUUID()}.${BRAND_EXT[type]}`;
  await store.put(path, bytes, type);
  return store.publicUrl(path);
}

export async function saveBrandingAction(form: FormData) {
  await act("/settings/branding", async (adminId) => {
    const before = await brandRepo().get().catch(() => null);
    const image = async (field: "logo" | "mark") => {
      const file = form.get(`${field}_file`);
      if (file instanceof File && file.size > 0) return uploadBrandImage(file);
      // Only the image already saved can be kept; anything else would point the brand at a file it doesn't own.
      return form.get(`${field}_remove`) === "on" ? "" : (field === "logo" ? before?.logo_url : before?.mark_url) ?? "";
    };
    let input;
    try {
      input = checkBrand({
        name: str(form, "name"), tagline: str(form, "tagline"), support_email: str(form, "support_email"), app_host: str(form, "app_host"),
        primary_color: str(form, "primary_color"), accent_color: str(form, "accent_color"), sidebar_color: str(form, "sidebar_color"),
        white_label_admin: form.get("white_label_admin") === "on", show_powered_by: form.get("show_powered_by") === "on",
        logo_url: await image("logo"), mark_url: await image("mark"),
      });
    } catch (e) {
      if (e instanceof BrandError) throw new ValidationError(e.message);
      throw e;
    }
    let saved;
    try {
      saved = await brandRepo().save(input, adminId);
    } catch (e) {
      if (/tenant_brands_app_host_key|duplicate key/i.test(e instanceof Error ? e.message : "")) throw new ValidationError("That sign-in address is already used by another account.");
      throw e;
    }
    // A replaced or removed logo's file is deleted after the 24-hour window (only this account's own brand images).
    const stale = [before?.logo_url, before?.mark_url]
      .filter((u): u is string => !!u && u !== saved.logo_url && u !== saved.mark_url)
      .map((u) => mediaPathFromUrl(u, currentTenantId()))
      .filter((p): p is string => !!p && p.startsWith("images/brands/"));
    await imageStore().discard([...new Set(stale)]).catch(() => undefined);
    return "Branding saved.";
  });
}

export async function removeDomainAction(form: FormData) {
  await act("/settings/email", async () => {
    const id = str(form, "id");
    if (!UUID.test(id)) throw new ValidationError("Not found.");
    const deps = automationDeps();
    const forms = await formDeps().repo.listForms().catch(() => []);
    const templates = await deps.repo.listTemplates();
    const senderIds = new Set((await deps.senders!.listSenders()).filter((s) => s.domain_id === id).map((s) => s.id));
    const domain = await removeDomain(deps.senders!, id, {
      formNames: forms.filter((f) => f.status !== "archived" && readSettings(f.settings).brand_domain_id === id).map((f) => f.name),
      templateNames: templates.filter((t) => t.sender_id && senderIds.has(t.sender_id) && t.active).map((t) => t.name),
    });
    return `${domain} disconnected. It is still set up in Resend, so you can add it again straight away.`;
  });
}

export async function saveBrandAction(form: FormData) {
  await act("/settings/email", async () => {
    const id = str(form, "id");
    if (!UUID.test(id)) throw new ValidationError("Not found.");
    const repo = automationDeps().senders!;
    if (!(await repo.getDomain(id))) throw new ValidationError("Not found.");
    const name = str(form, "brand_name").replace(/\s+/g, " ").trim().slice(0, 120);
    if (name && name.length < 2) throw new ValidationError("Give the firm or brand a name.");
    let host: string | null;
    try {
      host = cleanLinkHost(str(form, "link_host"));
    } catch (e) {
      throw new ValidationError(e instanceof Error ? e.message : "Enter a web address like app.yourfirm.com.");
    }
    await repo.updateDomain(id, { brand_name: name || null, link_host: host });
    return host ? `Saved. In production, this brand's form links use https://${host}. Make sure that address is added to the app's hosting (Vercel → Domains).` : "Saved.";
  });
}

export async function addSenderAction(form: FormData) {
  await act("/settings/email", async (adminId) => {
    const domainId = str(form, "domain_id");
    if (!UUID.test(domainId)) throw new ValidationError("Choose a domain.");
    const repo = automationDeps().senders!;
    if (!(await repo.getDomain(domainId))) throw new ValidationError("Choose a domain.");
    const replyTo = str(form, "reply_to").trim().toLowerCase();
    if (replyTo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo)) throw new ValidationError("Enter a valid reply-to address, or leave it blank.");
    const { sender, restored } = await addSender(repo, { domain_id: domainId, from_name: cleanFromName(str(form, "from_name")), local_part: cleanLocalPart(str(form, "local_part")), reply_to: replyTo || null, created_by: adminId });
    if (!(await repo.listSenders()).some((s) => s.is_default && !s.archived_at)) await repo.setDefaultSender(sender.id);
    return restored ? "Sending address added back." : "Sending address added.";
  });
}

export async function defaultSenderAction(form: FormData) {
  await act("/settings/email", async () => {
    const id = str(form, "id");
    if (!UUID.test(id)) throw new ValidationError("Not found.");
    await automationDeps().senders!.setDefaultSender(id);
    return "Default sending address changed.";
  });
}

export async function archiveSenderAction(form: FormData) {
  await act("/settings/email", async () => {
    const id = str(form, "id");
    if (!UUID.test(id)) throw new ValidationError("Not found.");
    const deps = automationDeps();
    const inUse = (await deps.repo.listTemplates()).some((t) => t.sender_id === id && t.active)
      || (await deps.repo.listWorkflows()).some((w) => w.status !== "archived" && w.actions.some((a) => (a.type === "send_document" || a.type === "request_signature") && a.sender_id === id));
    if (inUse) throw new ValidationError("This address is used by an active email template or workflow. Choose another address there first.");
    await deps.senders!.updateSender(id, { archived_at: new Date().toISOString() });
    return "Sending address removed.";
  });
}

export async function saveAttributeAction(form: FormData) {
  await act("/settings/package-attributes", async () => {
    const repo = automationDeps().senders!;
    const v = cleanAttribute({ key: str(form, "key"), label: str(form, "label"), kind: str(form, "kind"), options: str(form, "options") });
    const id = str(form, "id");
    if (UUID.test(id)) {
      await repo.updatePackageAttribute(id, { label: v.label, kind: v.kind, options: v.options });
      return "Attribute saved.";
    }
    await repo.insertPackageAttribute(v);
    return `Attribute added. Set it on each product as a product setting: ${v.key}: value.`;
  });
}

export async function deleteAttributeAction(form: FormData) {
  await act("/settings/package-attributes", async () => {
    const id = str(form, "id");
    if (!UUID.test(id)) throw new ValidationError("Not found.");
    const deps = automationDeps();
    const attr = (await deps.senders!.listPackageAttributes()).find((a) => a.id === id);
    if (!attr) throw new ValidationError("Not found.");
    const used = (await deps.repo.listWorkflows()).filter((w) => w.status !== "archived" && w.conditions.some((c) => c.field === `product.${attr.key}`));
    if (used.length) throw new ValidationError(`Used by ${used.map((w) => `"${w.name}"`).join(", ")}. Remove the condition there first.`);
    await deps.senders!.deletePackageAttribute(id);
    return "Attribute removed.";
  });
}

// ---- Text messaging: this office's own number, registration and credits (self-serve)

export async function saveSmsSetupAction(form: FormData) {
  await act("/settings/sms", async (adminId) => {
    const raw = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")) as Record<string, string>;
    const account = await saveSetupChoices(await smsSetupDeps(), raw, adminId);
    return account.chosen_number ? "Saved. Next, pay for the setup." : "Saved. Next, choose your number.";
  });
}

export async function chooseSmsNumberAction(form: FormData) {
  await act("/settings/sms", async () => {
    const account = await chooseNumber(await smsSetupDeps(), str(form, "number"));
    return `${account.chosen_number} is held for you until you pay. If someone else takes it first, you get another of the same kind.`;
  });
}

/** Sends the office to Stripe Checkout (setup, or a credit pack). Errors come back to the settings page. */
async function toCheckout(start: (adminId: string) => Promise<string>) {
  const admin = await requireAdmin();
  let target: string;
  try {
    target = await start(admin.userId);
  } catch (e) {
    const message = e instanceof ValidationError ? e.message : "The card payment couldn't be started. Nothing was charged. Please try again.";
    if (!(e instanceof ValidationError)) console.error(`sms checkout failed: ${sanitizeError(e, 200)}`);
    target = withParam("/settings/sms", "error", message);
  }
  redirect(target);
}

export async function startSmsSetupCheckoutAction() {
  await toCheckout(async (adminId) => {
    const d = await smsSetupDeps();
    return startSetupCheckout(d, smsPayments(), { origin: await appOrigin(), email: d.officeEmail }, adminId);
  });
}

export async function buySmsCreditsAction(form: FormData) {
  await toCheckout(async (adminId) => {
    const d = await smsSetupDeps();
    return startCreditsCheckout(d, smsPayments(), str(form, "packs"), { origin: await appOrigin(), email: d.officeEmail }, adminId);
  });
}

/** Retries a setup that stopped, or reads the carrier registration's status now instead of waiting for the daily check. */
export async function checkSmsStatusAction() {
  await act("/settings/sms", async () => {
    const d = await smsSetupDeps();
    const before = await d.repo.get();
    const a = before?.provision_status === "error" || before?.provision_status === "provisioning" ? await provision(d) : await advanceRegistration(d);
    if (a?.provision_status === "error") throw new ValidationError(`Setup hasn't finished: ${a.provision_error ?? "unknown problem"}. It's tried again automatically every day.`);
    return a?.registration_status === "approved" ? "Approved: you can text clients now." : a?.registration_status === "rejected" ? `Carriers rejected the registration: ${a.registration_error ?? ""}` : "Checked. Carriers are still reviewing your registration.";
  });
}
