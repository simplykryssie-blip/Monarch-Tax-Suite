// Two layers of branding.
//
// PLATFORM: the product itself is Verexa HQ. Its name, logo and tagline appear everywhere the software is the one
// speaking: the sign-in page, the admin shell, browser tabs and the default share image.
//
// TENANT: every account (tenant) keeps its own brand for what its customers see (Settings → Branding). A tenant's own name shows
// in the admin as "the account you are working in", next to the platform brand, never instead of it.

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
