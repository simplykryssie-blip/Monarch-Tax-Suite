// Firms/brands within one tenant (for example Monarch and MKB in one account). A brand is a connected sending
// domain (Piece 1, Settings → Email sending) with a display name and, optionally, the web address its public links
// use. Pure, so pages, actions and tests share the same rules.

export type BrandDomain = { id: string; domain: string; status: string; brand_name?: string | null; link_host?: string | null };
export type Brand = { id: string; name: string; domain: string; linkHost: string | null; verified: boolean };

export const brandsOf = (domains: BrandDomain[]): Brand[] =>
  domains.map((d) => ({ id: d.id, name: d.brand_name?.trim() || d.domain, domain: d.domain, linkHost: d.link_host ?? null, verified: d.status === "verified" }));

/** The brand a form belongs to: the one chosen; with no choice and exactly one brand, that one; otherwise none. */
export function effectiveBrand(chosenId: string | null | undefined, brands: Brand[]): Brand | null {
  if (chosenId) return brands.find((b) => b.id === chosenId) ?? null;
  return brands.length === 1 ? brands[0] : null;
}

const HOST = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** "https://Forms.MKB.com/" -> "forms.mkb.com". Throws a plain message for anything that is not a host name. */
export function cleanLinkHost(raw: string): string | null {
  const v = raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
  if (!v) return null;
  if (!HOST.test(v) || v.length > 253) throw new Error("Enter a web address like app.yourfirm.com (no https://, no path).");
  return v;
}

/** The host of the incoming request, from the platform's forwarding headers. Null when there is no request. */
export function hostFromHeaders(h: { get(name: string): string | null }): string | null {
  const raw = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0].trim().toLowerCase();
  return /^[a-z0-9.-]+(:\d{1,5})?$/.test(raw) && raw.length <= 260 ? raw : null;
}

/** Hosting-platform addresses (Vercel). Never shown to a respondent or put in a link. */
export const isPlatformHost = (host: string | null | undefined): boolean => !!host && /(^|\.)(vercel\.app|vercel\.sh|now\.sh|vercel\.dev)(:\d+)?$/i.test(host.trim());
const isLocalHost = (host: string) => /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);

/**
 * Where a form's public link points: the form's firm's own web address (Settings → Email sending), in every
 * environment. Without one, only localhost (development) or the office's own custom domain can be used; a hosting
 * platform address (*.vercel.app) is never returned, so the answer is null and the office is asked to set its domain.
 */
export function formPublicUrl(input: { publicId: string; brand: Brand | null; requestHost: string | null; production?: boolean; fallbackOrigin?: string | null }): string | null {
  const path = `/f/${input.publicId}`;
  if (input.brand?.linkHost && !isPlatformHost(input.brand.linkHost)) return `https://${input.brand.linkHost}${path}`;
  const host = input.requestHost;
  if (host && isLocalHost(host)) return `http://${host}${path}`;
  if (host && !isPlatformHost(host)) return `https://${host}${path}`;
  return null;
}

const SENDER_PREFIXES = new Set(["mail", "send", "email", "mg", "em", "notify", "notifications", "updates", "smtp", "bounce"]);

/**
 * The web address a firm's form links use when the office hasn't chosen one: forms.<its own domain>. A sending
 * subdomain such as mail.yourfirm.com maps to its parent (forms.yourfirm.com), so the office never has to invent it.
 */
export function defaultLinkHost(domain: string): string {
  const labels = domain.trim().toLowerCase().split(".").filter(Boolean);
  const root = labels.length > 2 && SENDER_PREFIXES.has(labels[0]) ? labels.slice(1) : labels;
  return `forms.${root.join(".")}`;
}

/** The tenant's brands, and which brand each live sender on a verified domain belongs to (sender id -> domain id). */
export function brandCatalogFrom(domains: BrandDomain[], senders: { id: string; domain_id: string; archived_at: string | null }[]): { brands: Brand[]; senderDomain: Record<string, string> } {
  const verified = new Set(domains.filter((d) => d.status === "verified").map((d) => d.id));
  return { brands: brandsOf(domains), senderDomain: Object.fromEntries(senders.filter((x) => !x.archived_at && verified.has(x.domain_id)).map((x) => [x.id, x.domain_id])) };
}
