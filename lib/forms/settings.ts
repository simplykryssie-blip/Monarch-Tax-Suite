import { cleanRedirectUrl } from "./message.ts";
import { inputFields, type Field, type FieldType, type FormDefinition } from "./definition.ts";
import { EMAIL } from "./answers.ts";

// Per-form settings: who the respondent is, the customer and firm records a submission links to or creates,
// notifications, messages and limits. Pure, so the settings page and the server use the same checks.

export const FIRM_ROLES = ["ero", "responsible_official", "principal", "tax_preparer", "office_administrator"] as const;
export type FirmRole = (typeof FIRM_ROLES)[number];
export const FIRM_ROLE_LABELS: Record<FirmRole, string> = { ero: "ERO", responsible_official: "Responsible official", principal: "Principal", tax_preparer: "Tax preparer", office_administrator: "Office administrator" };
export const FIRM_RELATIONSHIPS = ["partner", "client", "internal"] as const;
export type FirmRelationship = (typeof FIRM_RELATIONSHIPS)[number];

export type FirmPersonMap = { role: FirmRole; name_key: string; email_key: string | null; phone_key: string | null; ptin_key: string | null };
export type FirmMap = {
  enabled: boolean;
  relationship: FirmRelationship;
  legal_name_key: string | null;
  dba_name_key: string | null;
  ein_key: string | null;
  efin_key: string | null;
  address_key: string | null;
  people: FirmPersonMap[];
};

export type FormSettings = {
  respondent: { email_key: string | null; name_key: string | null };
  /** Link the submission to the customer with the respondent's email, creating one when there is none. */
  create_customer: boolean;
  firm: FirmMap;
  notify: { recipients: string[]; sender_id: string | null };
  /** The firm/brand (a connected sending domain) the form belongs to: its public link and emails use that brand. */
  brand_domain_id: string | null;
  /** "We received your submission" to the respondent (no answers, no files). */
  confirmation_email: boolean;
  confirmation_email_text: string;
  /** Shown after a submission; supports **bold** and line breaks. */
  confirmation_message: string;
  /** After submitting: show the confirmation message, or send the respondent to `redirect_url`. */
  after_submit: "message" | "redirect";
  redirect_url: string | null;
  closed_message: string;
  close_at: string | null;
  max_submissions: number | null;
  allow_save_later: boolean;
};

export const DEFAULT_SETTINGS: FormSettings = {
  respondent: { email_key: null, name_key: null },
  create_customer: true,
  firm: { enabled: false, relationship: "partner", legal_name_key: null, dba_name_key: null, ein_key: null, efin_key: null, address_key: null, people: [] },
  notify: { recipients: [], sender_id: null },
  brand_domain_id: null,
  confirmation_email: true,
  confirmation_email_text: "",
  confirmation_message: "Thank you, your submission was received.",
  after_submit: "message",
  redirect_url: null,
  closed_message: "This form is not accepting submissions right now.",
  close_at: null,
  max_submissions: null,
  allow_save_later: true,
};

export class SettingsError extends Error {}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim().slice(0, max) : "");
const longStr = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim().slice(0, max) : "");

/** Reads stored settings, filling in defaults for anything missing. Never throws. */
export function readSettings(raw: unknown): FormSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<FormSettings>;
  return {
    ...DEFAULT_SETTINGS,
    ...r,
    respondent: { ...DEFAULT_SETTINGS.respondent, ...(r.respondent ?? {}) },
    firm: { ...DEFAULT_SETTINGS.firm, ...(r.firm ?? {}), people: Array.isArray(r.firm?.people) ? r.firm.people : [] },
    notify: { ...DEFAULT_SETTINGS.notify, ...(r.notify ?? {}), recipients: Array.isArray(r.notify?.recipients) ? r.notify.recipients : [] },
  };
}

type Want = { types: FieldType[]; format?: Field["format"]; what: string };
function pick(fields: Map<string, Field>, raw: unknown, want: Want, label: string, required = false): string | null {
  const key = str(raw, 40);
  if (!key) {
    if (required) throw new SettingsError(`Choose the question that holds the ${label}.`);
    return null;
  }
  const f = fields.get(key);
  if (!f) throw new SettingsError(`The ${label} question ("${key}") is no longer on the form. Choose another.`);
  if (!want.types.includes(f.type)) throw new SettingsError(`The ${label} must come from ${want.what}; "${f.label}" is not.`);
  if (want.format !== undefined && f.format !== want.format) throw new SettingsError(`The ${label} must come from a short answer checked as ${String(want.format).toUpperCase()} (set "Check as" on "${f.label}").`);
  return key;
}

/**
 * Checks settings from the settings page against the form's questions and the tenant's verified senders.
 * Questions are referred to by key, so they keep working when the form is edited, until a question is removed.
 */
/** The tenant's brands, and which brand each verified sender belongs to (sender id -> domain id). */
export type BrandCatalog = { brandIds: string[]; senderDomain: Record<string, string> };

export function checkSettings(raw: unknown, def: FormDefinition, senderIds: string[], brands: BrandCatalog = { brandIds: [], senderDomain: {} }): FormSettings {
  // Loosely typed input from the settings page; every value is checked below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = (raw ?? {}) as Record<string, any>;
  const fields = new Map(inputFields(def).map((f) => [f.key, f]));
  const text: Want = { types: ["short_text"], what: "a short answer" };
  const respondent = {
    email_key: pick(fields, r.respondent?.email_key, { types: ["email"], what: "an email question" }, "respondent's email"),
    name_key: pick(fields, r.respondent?.name_key, text, "respondent's name"),
  };
  const create_customer = r.create_customer !== false && r.create_customer !== "off";

  const fr = r.firm ?? {};
  const enabled = fr.enabled === true || fr.enabled === "on";
  const firm: FirmMap = {
    enabled,
    relationship: (FIRM_RELATIONSHIPS as readonly string[]).includes(fr.relationship) ? (fr.relationship as FirmRelationship) : "partner",
    legal_name_key: pick(fields, fr.legal_name_key, text, "firm's legal name", enabled),
    dba_name_key: pick(fields, fr.dba_name_key, text, "firm's DBA name"),
    ein_key: pick(fields, fr.ein_key, { ...text, format: "ein", what: "a short answer" }, "EIN"),
    efin_key: pick(fields, fr.efin_key, { ...text, format: "efin", what: "a short answer" }, "EFIN"),
    address_key: pick(fields, fr.address_key, { types: ["address"], what: "an address question" }, "office address"),
    people: [],
  };
  const people = Array.isArray(fr.people) ? fr.people : [];
  if (people.length > 10) throw new SettingsError("A firm can map at most 10 people.");
  for (const [i, p] of people.entries()) {
    const nameKey = str(p?.name_key, 40);
    if (!nameKey) continue;
    const role = (FIRM_ROLES as readonly string[]).includes(p?.role) ? (p.role as FirmRole) : "tax_preparer";
    const n = `person ${i + 1}`;
    firm.people.push({
      role,
      name_key: pick(fields, nameKey, text, `${n}'s name`, true)!,
      email_key: pick(fields, p?.email_key, { types: ["email"], what: "an email question" }, `${n}'s email`),
      phone_key: pick(fields, p?.phone_key, { types: ["phone"], what: "a phone question" }, `${n}'s phone`),
      ptin_key: pick(fields, p?.ptin_key, { ...text, format: "ptin", what: "a short answer" }, `${n}'s PTIN`),
    });
  }
  if (enabled && !firm.people.length) throw new SettingsError("Map at least one person for the firm (usually the ERO or owner).");
  if (enabled && !respondent.email_key && !inputFields(def).some((f) => f.type === "email")) throw new SettingsError("To create firm records, the form needs an email question, so the firm is linked to the customer.");

  const recipients = [...new Set((Array.isArray(r.notify?.recipients) ? r.notify.recipients : String(r.notify?.recipients ?? "").split(/[,\s]+/)).map((x: unknown) => str(x, 254).toLowerCase()).filter(Boolean))] as string[];
  if (recipients.length > 5) throw new SettingsError("Notify at most 5 addresses.");
  const bad = recipients.find((x) => !EMAIL.test(x));
  if (bad) throw new SettingsError(`"${bad}" is not a valid email address.`);
  const sender = str(r.notify?.sender_id, 60);
  if (sender && !senderIds.includes(sender)) throw new SettingsError("Choose one of your verified sending addresses.");
  const brand = str(r.brand_domain_id, 60);
  if (brand && !brands.brandIds.includes(brand)) throw new SettingsError("Choose one of your firms/brands.");
  if (brands.brandIds.length > 1 && !brand) throw new SettingsError("Choose which firm this form belongs to.");
  if (brand && sender && brands.senderDomain[sender] && brands.senderDomain[sender] !== brand) throw new SettingsError("The notification address must belong to the form's firm. Choose one of that firm's sending addresses, or the firm's default.");

  const after_submit: FormSettings["after_submit"] = r.after_submit === "redirect" ? "redirect" : "message";
  let redirect_url: string | null = null;
  try {
    redirect_url = cleanRedirectUrl(longStr(r.redirect_url, 2100));
  } catch (e) {
    if (after_submit === "redirect") throw new SettingsError((e as Error).message);
  }
  if (after_submit === "redirect" && !redirect_url) throw new SettingsError("Enter the web address to send people to after they submit.");

  const closeAt = str(r.close_at, 40);
  if (closeAt && Number.isNaN(Date.parse(closeAt))) throw new SettingsError("Enter a valid close date.");
  const maxRaw = str(r.max_submissions, 7);
  const max = maxRaw ? Number(maxRaw) : null;
  if (max !== null && (!Number.isInteger(max) || max < 1 || max > 1_000_000)) throw new SettingsError("The submission limit must be a whole number, 1 or more.");

  return {
    respondent,
    create_customer,
    firm,
    notify: { recipients, sender_id: sender || null },
    brand_domain_id: brand || null,
    confirmation_email: r.confirmation_email !== false && r.confirmation_email !== "off",
    confirmation_email_text: longStr(r.confirmation_email_text, 2000),
    confirmation_message: longStr(r.confirmation_message, 2000) || DEFAULT_SETTINGS.confirmation_message,
    after_submit,
    redirect_url,
    closed_message: longStr(r.closed_message, 1000) || DEFAULT_SETTINGS.closed_message,
    close_at: closeAt ? new Date(closeAt).toISOString() : null,
    max_submissions: max,
    allow_save_later: r.allow_save_later !== false && r.allow_save_later !== "off",
  };
}

/**
 * The questions that identify the respondent. Uses the ones chosen in Settings; when none is chosen, the form's first
 * email question, and the first short answer whose key or label mentions a name, so every submission with an email
 * still links to its customer.
 */
export function respondentKeys(settings: FormSettings, def: FormDefinition): { email_key: string | null; name_key: string | null } {
  const fields = inputFields(def);
  const email = settings.respondent.email_key && fields.some((f) => f.key === settings.respondent.email_key) ? settings.respondent.email_key : fields.find((f) => f.type === "email")?.key ?? null;
  const name = settings.respondent.name_key && fields.some((f) => f.key === settings.respondent.name_key)
    ? settings.respondent.name_key
    : fields.find((f) => f.type === "short_text" && !f.format && !f.sensitive && /name/i.test(`${f.key} ${f.label}`) && !/business|company|firm|dba|legal/i.test(`${f.key} ${f.label}`))?.key ?? null;
  return { email_key: email, name_key: name };
}

/** Problems with stored settings against a definition about to be published (for example a mapped question was deleted). */
export function settingsProblems(settings: FormSettings, def: FormDefinition, brands?: BrandCatalog): string[] {
  try {
    checkSettings(settings, def, settings.notify.sender_id ? [settings.notify.sender_id] : [], brands ?? { brandIds: settings.brand_domain_id ? [settings.brand_domain_id] : [], senderDomain: {} });
    return [];
  } catch (e) {
    return [e instanceof Error ? e.message : "The form settings need attention."];
  }
}
