import { ValidationError } from "../commerce/validation.ts";
import { PLATFORM_DOMAIN } from "../platform-brand.ts";

// Where a site answers. Every office gets <label>.<platform domain> automatically (needs a wildcard DNS record for that
// domain); an office can also connect its own domain. The platform domain defaults to Verexa HQ's and can be set with
// PLATFORM_SITE_DOMAIN. It is a subdomain (sites.verexahq.com) so the wildcard can be delegated to Vercel on its own
// without moving the rest of verexahq.com's DNS.

export const DEFAULT_PLATFORM_DOMAIN = "sites.verexahq.com";

/** The domain office subdomains live under. */
export function platformDomain(env: Record<string, string | undefined> = process.env): string {
  const v = (env.PLATFORM_SITE_DOMAIN ?? "").trim().toLowerCase().replace(/^\.+|\.+$/g, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(v) ? v : DEFAULT_PLATFORM_DOMAIN;
}

/** Labels that belong to the platform itself and can never be an office's address. */
export const RESERVED_LABELS = new Set([
  "www", "app", "api", "admin", "book", "mail", "email", "send", "rsend", "smtp", "imap", "pop", "ftp", "ns", "ns1", "ns2", "mx", "dns",
  "auth", "login", "signin", "portal", "office", "practice", "static", "assets", "cdn", "media", "files", "forms", "form", "sites", "site",
  "support", "help", "status", "docs", "blog", "shop", "store", "billing", "pay", "payments", "verexa", "verexahq", "monarch", "stripe",
  "webhook", "webhooks", "test", "staging", "preview", "dev", "demo", "root", "null", "undefined",
]);

const LABEL = /^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/;

/** Turns a name into a candidate address label ("Smith & Sons Tax, LLC" → "smith-sons-tax-llc"). */
export function labelFromName(name: string): string {
  const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 39).replace(/-+$/g, "");
  return base.length >= 3 ? base : `office-${base || "site"}`.slice(0, 39).replace(/-+$/g, "");
}

/** Checks an address label an office typed. Returns the clean label or throws a plain message. */
export function cleanLabel(raw: unknown): string {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!LABEL.test(v) || v.includes("--")) throw new ValidationError("Use 3 to 40 letters, numbers or single hyphens, starting and ending with a letter or number.");
  if (RESERVED_LABELS.has(v)) throw new ValidationError("That address is reserved. Choose another.");
  return v;
}

export const subdomainHost = (label: string, domain: string = platformDomain()) => `${label}.${domain}`;

const HOST = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

/**
 * Checks a custom domain an office typed ("https://www.Smith-Tax.com/" → "www.smith-tax.com"). Refuses the platform's
 * own domain and its subdomains, hosting-platform addresses, IP addresses and anything that isn't a plain host name.
 */
export function cleanCustomHost(raw: unknown, domain: string = platformDomain()): string {
  const v = (typeof raw === "string" ? raw : "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/?#].*$/, "").replace(/:\d+$/, "").replace(/\.$/, "");
  if (!v) throw new ValidationError("Enter your domain, like www.yourfirm.com.");
  if (!HOST.test(v) || v.length > 253) throw new ValidationError("That isn't a valid domain. Enter it like www.yourfirm.com (no https://, no path).");
  if (/^\d+(\.\d+)+$/.test(v)) throw new ValidationError("Enter a domain name, not an IP address.");
  if (v === domain || v.endsWith(`.${domain}`)) throw new ValidationError(`${domain} addresses are made for you automatically; connect a domain you own.`);
  if (v === PLATFORM_DOMAIN || v.endsWith(`.${PLATFORM_DOMAIN}`)) throw new ValidationError(`${PLATFORM_DOMAIN} addresses belong to the platform; connect a domain you own.`);
  if (/(^|\.)(vercel\.app|vercel\.sh|vercel\.dev|now\.sh|localhost|local|internal|test|example)$/.test(v)) throw new ValidationError("That address can't be used as a website domain.");
  const tld = v.split(".").pop() ?? "";
  if (tld.length < 2 || /^\d+$/.test(tld)) throw new ValidationError("That isn't a valid domain.");
  return v;
}

/** Whether a host is an apex (yourfirm.com) rather than a subdomain (www.yourfirm.com). Two-part public suffixes (co.uk) are treated as apex when they have three labels. */
export function isApex(host: string): boolean {
  const labels = host.split(".");
  if (labels.length === 2) return true;
  const SECOND_LEVEL = new Set(["co", "com", "org", "net", "gov", "edu", "ac"]);
  return labels.length === 3 && SECOND_LEVEL.has(labels[1]) && labels[2].length === 2;
}

export const VERCEL_A_RECORD = "76.76.21.21";
export const VERCEL_CNAME = "cname.vercel-dns.com";

export type DnsRecord = { type: "A" | "CNAME" | "TXT"; name: string; value: string; note?: string };

/** The DNS records an office adds at its registrar: the address record, plus any ownership-proof records Vercel asks for. */
export function dnsInstructions(host: string, verification: { type: string; domain: string; value: string }[] = []): DnsRecord[] {
  const records: DnsRecord[] = isApex(host)
    ? [{ type: "A", name: "@", value: VERCEL_A_RECORD, note: "Points your domain at the website host." }]
    : [{ type: "CNAME", name: host.slice(0, host.indexOf(".")), value: VERCEL_CNAME, note: "Points this address at the website host." }];
  for (const v of verification) {
    if (v.type.toUpperCase() === "TXT") records.push({ type: "TXT", name: v.domain, value: v.value, note: "Proves you own the domain (needed because it is already used elsewhere)." });
  }
  return records;
}
