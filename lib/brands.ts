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

/**
 * Where a form's public link points. In production, the form's brand's web address when one is set. Otherwise
 * (Preview, local, or no brand address) the host of the request being served right now, so the link always opens on
 * the deployment the administrator is looking at. `fallbackOrigin` is only for code running without a request.
 */
export function formPublicUrl(input: { publicId: string; brand: Brand | null; requestHost: string | null; production: boolean; fallbackOrigin?: string | null }): string {
  const path = `/f/${input.publicId}`;
  if (input.production && input.brand?.linkHost) return `https://${input.brand.linkHost}${path}`;
  if (input.requestHost) return `${/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(input.requestHost) ? "http" : "https"}://${input.requestHost}${path}`;
  return `${(input.fallbackOrigin ?? "").replace(/\/$/, "")}${path}`;
}

/** The tenant's brands, and which brand each live sender on a verified domain belongs to (sender id -> domain id). */
export function brandCatalogFrom(domains: BrandDomain[], senders: { id: string; domain_id: string; archived_at: string | null }[]): { brands: Brand[]; senderDomain: Record<string, string> } {
  const verified = new Set(domains.filter((d) => d.status === "verified").map((d) => d.id));
  return { brands: brandsOf(domains), senderDomain: Object.fromEntries(senders.filter((x) => !x.archived_at && verified.has(x.domain_id)).map((x) => [x.id, x.domain_id])) };
}
