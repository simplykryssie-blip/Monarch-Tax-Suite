import { ValidationError } from "../commerce/validation.ts";
import { sanitizeError } from "./sanitize.ts";

// Sending identities. A tenant connects its own domains (verified with the email provider) and adds from-addresses
// ("brands") on them; each workflow email chooses which one it sends from. Nothing is sent from a domain that is not
// verified.

export type EmailDomainRow = {
  id: string;
  tenant_id: string;
  domain: string;
  provider_domain_id: string | null;
  status: "pending" | "verified" | "failed";
  dns_records: DnsRecord[];
  last_checked_at: string | null;
  /** The firm/brand this domain stands for, and the web address its public form links use in production. */
  brand_name?: string | null;
  link_host?: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};
export type DnsRecord = { record: string; type: string; name: string; value: string; priority?: number | null; status?: string | null };

export type SenderRow = {
  id: string;
  tenant_id: string;
  domain_id: string;
  from_name: string;
  local_part: string;
  reply_to: string | null;
  is_default: boolean;
  archived_at: string | null;
  created_by: string | null;
  created_at: string;
};

export type PackageAttribute = { id: string; tenant_id: string; key: string; label: string; kind: "choice" | "text"; options: string[]; created_at: string };

export interface SendersRepo {
  listDomains(): Promise<EmailDomainRow[]>;
  getDomain(id: string): Promise<EmailDomainRow | null>;
  insertDomain(input: Pick<EmailDomainRow, "domain" | "provider_domain_id" | "status" | "dns_records" | "created_by">): Promise<EmailDomainRow>;
  updateDomain(id: string, patch: Partial<Pick<EmailDomainRow, "status" | "dns_records" | "last_checked_at" | "provider_domain_id" | "brand_name" | "link_host">>): Promise<EmailDomainRow>;
  /** Removes a domain from this account (not from the email provider). Refused by the database while a sender still uses it. */
  deleteDomain(id: string): Promise<void>;
  deleteSender(id: string): Promise<void>;
  listSenders(): Promise<SenderRow[]>;
  getSender(id: string): Promise<SenderRow | null>;
  insertSender(input: Pick<SenderRow, "domain_id" | "from_name" | "local_part" | "reply_to" | "created_by">): Promise<SenderRow>;
  updateSender(id: string, patch: Partial<Pick<SenderRow, "from_name" | "reply_to" | "archived_at">>): Promise<SenderRow>;
  /** Makes one sender the tenant's default (clearing any other). */
  setDefaultSender(id: string): Promise<void>;
  listPackageAttributes(): Promise<PackageAttribute[]>;
  insertPackageAttribute(input: Pick<PackageAttribute, "key" | "label" | "kind" | "options">): Promise<PackageAttribute>;
  updatePackageAttribute(id: string, patch: Partial<Pick<PackageAttribute, "label" | "kind" | "options">>): Promise<PackageAttribute>;
  deletePackageAttribute(id: string): Promise<void>;
}

export type ResolvedSender = { from: string; replyTo: string | null; label: string };

const quoted = (name: string) => `"${name.replace(/["\\\r\n<>]/g, "").trim()}"`;
export const senderAddress = (s: Pick<SenderRow, "local_part">, d: Pick<EmailDomainRow, "domain">) => `${s.local_part}@${d.domain}`;
export const fromHeader = (s: Pick<SenderRow, "from_name" | "local_part">, d: Pick<EmailDomainRow, "domain">) => `${quoted(s.from_name)} <${senderAddress(s, d)}>`;

/**
 * Who an email is sent from. A chosen sender must be live and on a verified domain; with none chosen, the tenant's
 * default sender. `fallback` (the platform's own configured sender) is used only for tenants allowed to use it.
 */
export async function resolveSender(repo: SendersRepo | null, senderId: string | null, fallback: ResolvedSender | null): Promise<ResolvedSender> {
  const pick = async (s: SenderRow | null, chosen: boolean): Promise<ResolvedSender | null> => {
    if (!s || s.archived_at) {
      if (chosen) throw new ValidationError("The sending address chosen for this email was removed. Choose another one.");
      return null;
    }
    const d = await repo!.getDomain(s.domain_id);
    if (!d || d.status !== "verified") {
      if (chosen) throw new ValidationError(`The domain for "${s.from_name}" is not verified yet, so nothing can be sent from it. Finish its DNS setup in Settings → Email sending.`);
      return null;
    }
    return { from: fromHeader(s, d), replyTo: s.reply_to, label: `${s.from_name} <${senderAddress(s, d)}>` };
  };
  if (repo && senderId) return (await pick(await repo.getSender(senderId), true))!;
  if (repo) {
    // A failed lookup of the default (for example before the sender tables exist) falls back rather than blocking mail.
    const def = await repo.listSenders().then((all) => all.find((s) => s.is_default && !s.archived_at) ?? null).catch(() => null);
    const resolved = await pick(def, false).catch(() => null);
    if (resolved) return resolved;
  }
  if (fallback) return fallback;
  throw new ValidationError("There is no verified sending address yet. Connect your domain in Settings → Email sending.");
}

/**
 * Disconnects a domain from this account so it can be added again. Nothing is removed at the email provider, so a
 * domain already verified there comes straight back. Refused while an active sending address, a form or a template
 * still uses it, with a message saying what to change first.
 */
export async function removeDomain(repo: SendersRepo, id: string, usedBy: { formNames: string[]; templateNames: string[] }): Promise<string> {
  const d = await repo.getDomain(id);
  if (!d) throw new ValidationError("Not found.");
  const senders = (await repo.listSenders()).filter((s) => s.domain_id === id);
  const active = senders.filter((s) => !s.archived_at);
  if (active.length) throw new ValidationError(`${d.domain} still has sending addresses (${active.map((s) => senderAddress(s, d)).join(", ")}). Remove them first, then disconnect the domain.`);
  if (usedBy.formNames.length) throw new ValidationError(`${d.domain} is the firm for ${usedBy.formNames.length} form${usedBy.formNames.length === 1 ? "" : "s"} (${usedBy.formNames.slice(0, 3).join(", ")}${usedBy.formNames.length > 3 ? ", …" : ""}). Choose another firm for ${usedBy.formNames.length === 1 ? "it" : "them"} in the form's Settings first.`);
  if (usedBy.templateNames.length) throw new ValidationError(`${d.domain} is used by ${usedBy.templateNames.length} email template${usedBy.templateNames.length === 1 ? "" : "s"} (${usedBy.templateNames.slice(0, 3).join(", ")}). Choose another sending address there first.`);
  try {
    for (const s of senders) await repo.deleteSender(s.id);
    await repo.deleteDomain(id);
  } catch (e) {
    if (/foreign key|violates|restrict/i.test(e instanceof Error ? e.message : "")) throw new ValidationError(`${d.domain} is still referenced by an email template or workflow. Choose another sending address there first.`);
    throw e;
  }
  return d.domain;
}

// ------------------------------------------------------------- validation

const DOMAIN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
export function cleanDomain(raw: string): string {
  const d = raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
  if (!DOMAIN.test(d) || d.length > 253) throw new ValidationError("Enter your domain, like yourfirm.com or mail.yourfirm.com (no http://, no @).");
  return d;
}
export function cleanLocalPart(raw: string): string {
  const v = raw.trim().toLowerCase();
  if (!/^[a-z0-9]([a-z0-9._+-]{0,62}[a-z0-9])?$/.test(v)) throw new ValidationError("Enter the part before the @, for example support.");
  return v;
}
export function cleanFromName(raw: string): string {
  const v = raw.replace(/[<>"\r\n]/g, "").replace(/\s+/g, " ").trim();
  if (v.length < 2 || v.length > 80) throw new ValidationError("Enter the name people see, for example your firm or brand name.");
  return v;
}

export const ATTRIBUTE_KEY = /^[a-z][a-z0-9_]{1,39}$/;
export function cleanAttribute(input: { key: string; label: string; kind: string; options: string }) {
  const key = input.key.trim().toLowerCase();
  if (!ATTRIBUTE_KEY.test(key)) throw new ValidationError("The key must be lowercase letters, numbers and underscores, starting with a letter (for example flow_type).");
  const label = input.label.replace(/\s+/g, " ").trim();
  if (label.length < 2 || label.length > 80) throw new ValidationError("Give the attribute a label.");
  const kind = input.kind === "text" ? "text" : "choice";
  const options = [...new Set(input.options.split(/[,\n]/).map((o) => o.trim()).filter(Boolean))];
  if (kind === "choice" && options.length < 2) throw new ValidationError("A choice attribute needs at least two options, separated by commas.");
  if (options.some((o) => o.length > 60) || options.length > 30) throw new ValidationError("Options can be at most 60 characters each, and at most 30 of them.");
  return { key, label, kind, options: kind === "choice" ? options : [] } as const;
}

// ----------------------------------------------- email provider (Resend) domains

export type ProviderDomain = { id: string; status: EmailDomainRow["status"]; records: DnsRecord[] };

const mapStatus = (s: unknown): EmailDomainRow["status"] => (s === "verified" ? "verified" : s === "failed" || s === "temporary_failure" ? "failed" : "pending");
const mapRecords = (r: unknown): DnsRecord[] =>
  Array.isArray(r) ? r.slice(0, 20).map((x: Record<string, unknown>) => ({ record: String(x.record ?? ""), type: String(x.type ?? ""), name: String(x.name ?? ""), value: String(x.value ?? ""), priority: typeof x.priority === "number" ? x.priority : null, status: typeof x.status === "string" ? x.status : null })) : [];

export class AlreadyRegisteredError extends ValidationError {
  constructor() {
    super("That domain is already registered with the email provider. Contact support to move it to this account.");
  }
}

/** Domain management with the email provider. Needs a full-access API key (sending-only keys cannot manage domains). */
export class ResendDomains {
  private key: string | null;
  private fetchImpl: typeof fetch;
  /** The environment variable the key came from, so a refusal can say exactly which one to change. */
  private source: string;
  constructor(key: string | null, fetchImpl: typeof fetch = fetch, source: string | null = null) {
    this.key = key;
    this.fetchImpl = fetchImpl;
    this.source = source ?? "RESEND_API_KEY";
  }
  private async call(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    if (!this.key) throw new ValidationError("Email sending is not configured (RESEND_API_KEY).");
    let res: Response;
    try {
      res = await this.fetchImpl(`https://api.resend.com${path}`, { ...init, headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(10_000) });
    } catch (e) {
      throw new Error(`Could not reach the email provider: ${sanitizeError(e, 120)}`);
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const said = String(body.message ?? "");
    // Resend answers 403 (as well as 409/422) when the domain is already in the account, which is not a key problem.
    if (res.status === 409 || ((res.status === 403 || res.status === 422) && /already|registered|exists/i.test(said))) throw new AlreadyRegisteredError();
    const detail = said ? ` Resend said: "${sanitizeError(said, 160)}".` : "";
    if (res.status === 403) throw new ValidationError(`Resend says the key in ${this.source} is not valid (403). It was probably copied incompletely (it should start with "re_"), pasted with quotes or spaces, deleted in Resend, or created in a different Resend workspace than your domains. In Resend create a new API key with "Full access", copy it straight away (Resend shows it once), save it as ${this.source} in Vercel for Production, then redeploy.${detail}`);
    if (res.status === 401) throw new ValidationError(`Resend refused the key in ${this.source} (401): it can send email but cannot manage domains. In Resend create an API key with "Full access", save it as ${this.source} in Vercel for Production (replace the old value), then redeploy. A changed variable only takes effect on a new deployment.${detail}`);
    if (!res.ok) throw new ValidationError(`The email provider refused the request: ${sanitizeError(String(body.message ?? res.status), 160)}`);
    return body;
  }
  async create(domain: string): Promise<ProviderDomain> {
    const b = await this.call("/domains", { method: "POST", body: JSON.stringify({ name: domain }) });
    return { id: String(b.id), status: mapStatus(b.status), records: mapRecords(b.records) };
  }
  async get(id: string): Promise<ProviderDomain> {
    const b = await this.call(`/domains/${encodeURIComponent(id)}`);
    return { id: String(b.id), status: mapStatus(b.status), records: mapRecords(b.records) };
  }
  /** A domain already registered on the platform's own provider account, by name. */
  async findByName(domain: string): Promise<ProviderDomain | null> {
    const b = await this.call("/domains");
    const found = (Array.isArray(b.data) ? b.data : []).find((d: Record<string, unknown>) => String(d.name ?? "").toLowerCase() === domain);
    return found ? this.get(String((found as Record<string, unknown>).id)) : null;
  }
  async verify(id: string): Promise<void> {
    await this.call(`/domains/${encodeURIComponent(id)}/verify`, { method: "POST" });
  }
}
