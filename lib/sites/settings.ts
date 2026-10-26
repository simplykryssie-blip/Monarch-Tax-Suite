import { cleanHref } from "./blocks.ts";

// A website's look and details, and the search-engine (SEO) details of the website and of each page. Everything is plain data
// that is checked on the way in: an unknown key is dropped, a bad color, link or picture is refused (left empty), never kept.

/** `google` is the family name on Google Fonts (with weights); the page loads it only when a site picks it. The stack is the fallback while it loads. */
export const FONT_CHOICES = {
  system: { label: "System (clean sans-serif)", stack: 'system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif' },
  inter: { label: "Inter (modern, neutral)", stack: 'Inter,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif', google: "Inter:wght@400;500;600;700;800" },
  dmsans: { label: "DM Sans (friendly, geometric)", stack: '"DM Sans",system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif', google: "DM+Sans:wght@400;500;600;700" },
  poppins: { label: "Poppins (rounded, bold)", stack: 'Poppins,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif', google: "Poppins:wght@400;500;600;700" },
  montserrat: { label: "Montserrat (strong, corporate)", stack: 'Montserrat,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif', google: "Montserrat:wght@400;500;600;700;800" },
  opensans: { label: "Open Sans (easy to read)", stack: '"Open Sans",system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif', google: "Open+Sans:wght@400;600;700;800" },
  raleway: { label: "Raleway (light, stylish)", stack: 'Raleway,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif', google: "Raleway:wght@400;500;600;700;800" },
  playfair: { label: "Playfair Display (elegant serif)", stack: '"Playfair Display",Georgia,"Times New Roman",serif', google: "Playfair+Display:wght@400;600;700;800" },
  lora: { label: "Lora (warm serif)", stack: 'Lora,Georgia,"Times New Roman",serif', google: "Lora:wght@400;500;600;700" },
  georgia: { label: "Georgia (classic serif)", stack: 'Georgia,"Times New Roman",serif' },
  palatino: { label: "Palatino (book serif)", stack: '"Palatino Linotype",Palatino,"Book Antiqua",Georgia,serif' },
  trebuchet: { label: "Trebuchet (rounded sans-serif)", stack: '"Trebuchet MS","Lucida Grande",Verdana,sans-serif' },
  verdana: { label: "Verdana (wide, easy to read)", stack: "Verdana,Geneva,Tahoma,sans-serif" },
} as const satisfies Record<string, { label: string; stack: string; google?: string }>;
export type FontChoice = keyof typeof FONT_CHOICES;
export const FONT_KEYS = Object.keys(FONT_CHOICES) as FontChoice[];

export const SOCIALS = ["facebook", "instagram", "linkedin", "youtube", "x", "tiktok"] as const;
export type Social = (typeof SOCIALS)[number];

export type SiteSettings = {
  brand: { primary: string | null; accent: string | null; /** Behind every page of the website; null = white. */ pageBg: string | null; /** A photo behind every page, with a veil (0 to 80 percent) and light or dark text on top. */ pageBgImageId: string | null; pageBgVeil: number; pageBgText: "dark" | "light"; logoImageId: string | null; faviconImageId: string | null };
  fonts: { heading: FontChoice; body: FontChoice };
  header: { show: boolean; align: "left" | "center"; showPhone: boolean; ctaLabel: string; ctaHref: string };
  footer: { show: boolean; text: string; showContact: boolean; showHours: boolean; showSocial: boolean };
  /** Shown in the footer and header. Empty = the office's details from the firm profile. */
  contact: { phone: string; email: string; address: string };
  hours: string;
  social: Partial<Record<Social, string>>;
  /** Website-wide search details: used by every page that doesn't set its own. */
  seo: { title: string; description: string; titleSuffix: string; shareImageId: string | null; noindex: boolean };
};

export const DEFAULT_SETTINGS: SiteSettings = {
  brand: { primary: null, accent: null, pageBg: null, pageBgImageId: null, pageBgVeil: 0, pageBgText: "dark", logoImageId: null, faviconImageId: null },
  fonts: { heading: "inter", body: "inter" },
  header: { show: true, align: "left", showPhone: false, ctaLabel: "", ctaHref: "" },
  footer: { show: true, text: "", showContact: true, showHours: true, showSocial: true },
  contact: { phone: "", email: "", address: "" },
  hours: "",
  social: {},
  seo: { title: "", description: "", titleSuffix: "", shareImageId: null, noindex: false },
};

export const SEO_LIMITS = { title: 70, description: 160, hours: 600, footerText: 300 };

const HEX = /^#[0-9a-f]{6}$/i;
const UUID_OK = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const line = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
const para = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").trim().slice(0, max) : "");
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const bool = (v: unknown, fallback: boolean) => (v === true || v === "on" || v === "true" || v === "1" ? true : v === false || v === "off" || v === "false" || v === "0" ? false : fallback);
const color = (v: unknown) => (typeof v === "string" && HEX.test(v.trim()) ? v.trim().toLowerCase() : null);
const imageId = (v: unknown) => (typeof v === "string" && UUID_OK.test(v) ? v.toLowerCase() : null);
const font = (v: unknown, fallback: FontChoice): FontChoice => (typeof v === "string" && (FONT_KEYS as string[]).includes(v) ? (v as FontChoice) : fallback);
const https = (v: unknown) => { const s = line(v, 300); return /^https:\/\/[^\s"'<>]+$/.test(s) ? s : ""; };

export function cleanSiteSettings(raw: unknown): SiteSettings {
  const r = obj(raw), brand = obj(r.brand), fonts = obj(r.fonts), header = obj(r.header), footer = obj(r.footer), contact = obj(r.contact), seo = obj(r.seo), social = obj(r.social);
  const cta = line(header.ctaHref, 500);
  const d = DEFAULT_SETTINGS;
  const out: SiteSettings = {
    brand: { primary: color(brand.primary), accent: color(brand.accent), pageBg: color(brand.pageBg), pageBgImageId: imageId(brand.pageBgImageId), pageBgVeil: Math.min(80, Math.max(0, Math.round(Number(brand.pageBgVeil)) || 0)), pageBgText: brand.pageBgText === "light" ? "light" : "dark", logoImageId: imageId(brand.logoImageId), faviconImageId: imageId(brand.faviconImageId) },
    fonts: { heading: font(fonts.heading, d.fonts.heading), body: font(fonts.body, d.fonts.body) },
    header: { show: bool(header.show, d.header.show), align: header.align === "center" ? "center" : "left", showPhone: bool(header.showPhone, d.header.showPhone), ctaLabel: line(header.ctaLabel, 40), ctaHref: cta && cleanHref(cta) ? cleanHref(cta)! : "" },
    footer: { show: bool(footer.show, d.footer.show), text: para(footer.text, SEO_LIMITS.footerText), showContact: bool(footer.showContact, d.footer.showContact), showHours: bool(footer.showHours, d.footer.showHours), showSocial: bool(footer.showSocial, d.footer.showSocial) },
    contact: { phone: line(contact.phone, 40), email: /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(line(contact.email, 254)) ? line(contact.email, 254) : "", address: para(contact.address, 300) },
    hours: para(r.hours, SEO_LIMITS.hours),
    social: {},
    seo: { title: line(seo.title, SEO_LIMITS.title), description: line(seo.description, SEO_LIMITS.description), titleSuffix: line(seo.titleSuffix, 40), shareImageId: imageId(seo.shareImageId), noindex: bool(seo.noindex, false) },
  };
  for (const s of SOCIALS) { const url = https(social[s]); if (url) out.social[s] = url; }
  return out;
}

/** The Google Fonts stylesheet for the fonts a site picked, or null when it uses only fonts every device already has. */
export function googleFontsHref(fonts: { heading: FontChoice; body: FontChoice }): string | null {
  const fams = [...new Set([fonts.heading, fonts.body])].flatMap((k) => { const g = (FONT_CHOICES[k] as { google?: string }).google; return g ? [g] : []; });
  return fams.length ? `https://fonts.googleapis.com/css2?${fams.map((f) => `family=${f}`).join("&")}&display=swap` : null;
}

/** The settings stored on a website, with anything missing filled from the defaults. */
export const settingsOf = (stored: unknown): SiteSettings => cleanSiteSettings(stored);

export type PageSeo = { title: string; shareImageId: string | null; noindex: boolean };
export const EMPTY_SEO: PageSeo = { title: "", shareImageId: null, noindex: false };
export function cleanPageSeo(raw: unknown): PageSeo {
  const r = obj(raw);
  return { title: line(r.title, SEO_LIMITS.title), shareImageId: imageId(r.shareImageId), noindex: bool(r.noindex, false) };
}

/** What a search engine shows for a page: the page's own title, else its name; with the website's suffix. */
export function pageTitleFor(input: { siteName: string; settings: SiteSettings; pageTitle: string; seo: PageSeo; isHome: boolean }): string {
  const own = input.seo.title || input.pageTitle;
  if (input.isHome) return input.seo.title || input.settings.seo.title || input.siteName;
  const suffix = input.settings.seo.titleSuffix || input.siteName;
  return suffix ? `${own} | ${suffix}` : own;
}
export const pageDescriptionFor = (input: { description: string | null; settings: SiteSettings }): string | undefined => input.description?.trim() || input.settings.seo.description || undefined;
export const pageIsIndexed = (settings: SiteSettings, seo: PageSeo): boolean => !settings.seo.noindex && !seo.noindex;
