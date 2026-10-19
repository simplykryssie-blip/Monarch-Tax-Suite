// Two layers of branding.
//
// PLATFORM: the product itself is Verexa HQ. Its name, logo and tagline appear everywhere the software is the one
// speaking: the sign-in page, the admin shell, browser tabs and the default share image.
//
// TENANT: every account (tenant) keeps its own brand for what its customers see: Monarch Tax Suite (a tenant like any
// other) keeps its storefront, calculators, emails, forms and documents saying Monarch. A tenant's own name shows in the admin as "the account you
// are working in", next to the platform brand, never instead of it.

/** Where people reach the platform: the support address in emails and legal pages, and the platform's own domain. */
export const PLATFORM_SUPPORT_EMAIL = "support@verexahq.com";
export const PLATFORM_DOMAIN = "verexahq.com";

export const PLATFORM = {
  name: "Verexa HQ",
  /** Upper-case form for eyebrows and footers. */
  eyebrow: "VEREXA HQ",
  tagline: "Streamline. Automate. Grow.",
  description: "Verexa HQ: the CRM and automation platform for tax professionals. Streamline. Automate. Grow.",
  logo: "/brand/verexa-hq.png",
  logoFull: "/brand/verexa-hq-full.png",
  mark: "/brand/verexa-mark.png",
  favicon: "/verexa-favicon-32.png",
  appleIcon: "/verexa-apple-touch-icon.png",
  ogImage: { url: "/verexa-og-image.jpg", width: 1200, height: 630, alt: "Verexa HQ" },
} as const;

export type TenantBrand = { name: string; mark: string | null };

// Tenants with their own brand assets. Other tenants show the name from their firm profile (Settings → Firm profile).
const TENANT_BRANDS: Record<string, TenantBrand> = {
  "00000000-0000-4000-8000-000000000001": { name: "Monarch Tax Suite", mark: "/brand/mark.png" },
};

/** The brand shown for an account in the admin. `profileName` is the firm profile's display name, when there is one. */
export function tenantBrand(tenantId: string, profileName?: string | null): TenantBrand {
  return TENANT_BRANDS[tenantId] ?? { name: profileName?.trim() || "Your account", mark: null };
}
