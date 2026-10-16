import { onColor, type FormTheme } from "../forms/theme.ts";

// White-label branding for a tenant (account). Pure: the settings page, the shell, emails and public pages share
// these checks and defaults. The platform brand (Verexa HQ) is in lib/platform-brand.ts; a tenant's brand sits on top
// of it for the people the tenant serves.

export type TenantBrandRow = {
  tenant_id: string;
  name: string;
  tagline: string | null;
  logo_url: string | null;
  mark_url: string | null;
  primary_color: string | null;
  accent_color: string | null;
  sidebar_color: string | null;
  support_email: string | null;
  white_label_admin: boolean;
  show_powered_by: boolean;
  app_host: string | null;
  updated_at: string;
};

export type BrandInput = Omit<TenantBrandRow, "tenant_id" | "updated_at">;

/** A brand with every field settled: what the rest of the app reads. */
export type Brand = {
  name: string;
  tagline: string | null;
  logoUrl: string | null;
  markUrl: string | null;
  primary: string;
  accent: string;
  sidebar: string;
  supportEmail: string | null;
  whiteLabelAdmin: boolean;
  showPoweredBy: boolean;
  appHost: string | null;
  /** True when the tenant has set its own brand (as opposed to the fallback built from its firm name). */
  custom: boolean;
};

export const DEFAULT_PRIMARY = "#2563eb";
export const DEFAULT_ACCENT = "#171714";
export const DEFAULT_SIDEBAR = "#07101e";

export class BrandError extends Error {}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");

function color(raw: unknown, what: string): string | null {
  const v = clean(raw, 9);
  if (!v) return null;
  if (!HEX.test(v)) throw new BrandError(`${what} must be a colour like #1a2b3c.`);
  const l = v.toLowerCase();
  return l.length === 4 ? `#${l[1]}${l[1]}${l[2]}${l[2]}${l[3]}${l[3]}` : l;
}

/** An image address: https, or a path on this site. No spaces, quotes or brackets. */
export function imageRef(raw: unknown, what: string): string | null {
  const v = clean(raw, 600);
  if (!v) return null;
  if (!/^(https:\/\/|\/(?!\/))[^\s"'()<>\\]+$/.test(v)) throw new BrandError(`${what} must be a web address starting with https://.`);
  return v;
}

const HOST = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** Checks brand settings from the settings page. Throws BrandError naming the problem. */
export function checkBrand(raw: unknown): BrandInput {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const name = clean(r.name, 80);
  if (name.length < 2) throw new BrandError("Enter the name your clients and customers should see.");
  const support = clean(r.support_email, 254).toLowerCase();
  if (support && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(support)) throw new BrandError("Enter a valid support email address.");
  const hostRaw = clean(r.app_host, 253).toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
  if (hostRaw && !HOST.test(hostRaw)) throw new BrandError("Enter your sign-in address like app.yourfirm.com (no https://, no path).");
  const flag = (v: unknown) => v === true || v === "on" || v === "true";
  return {
    name,
    tagline: clean(r.tagline, 120) || null,
    logo_url: imageRef(r.logo_url, "The logo address"),
    mark_url: imageRef(r.mark_url, "The small logo (mark) address"),
    primary_color: color(r.primary_color, "The main colour"),
    accent_color: color(r.accent_color, "The accent colour"),
    sidebar_color: color(r.sidebar_color, "The menu colour"),
    support_email: support || null,
    white_label_admin: flag(r.white_label_admin),
    show_powered_by: flag(r.show_powered_by),
    app_host: hostRaw || null,
  };
}

/** The brand to use for a tenant: its saved brand, or one built from its firm name when it hasn't set any. */
export function brandOf(row: Partial<TenantBrandRow> | null | undefined, fallbackName?: string | null): Brand {
  return {
    name: row?.name?.trim() || fallbackName?.trim() || "Your account",
    tagline: row?.tagline ?? null,
    logoUrl: row?.logo_url ?? null,
    markUrl: row?.mark_url ?? row?.logo_url ?? null,
    primary: row?.primary_color ?? DEFAULT_PRIMARY,
    accent: row?.accent_color ?? DEFAULT_ACCENT,
    sidebar: row?.sidebar_color ?? DEFAULT_SIDEBAR,
    supportEmail: row?.support_email ?? null,
    whiteLabelAdmin: row?.white_label_admin === true,
    showPoweredBy: row?.show_powered_by === true,
    appHost: row?.app_host ?? null,
    custom: !!row,
  };
}

/** What emails need: the name, a header colour and the logo, plus whether to say "Powered by". */
export type EmailBrand = { name: string; color: string; textColor: string; logoUrl: string | null; supportEmail: string | null; poweredBy: boolean };

export function emailBrandOf(b: Brand): EmailBrand {
  return { name: b.name, color: b.sidebar, textColor: onColor(b.sidebar), logoUrl: b.logoUrl && /^https:\/\//.test(b.logoUrl) ? b.logoUrl : null, supportEmail: b.supportEmail, poweredBy: b.showPoweredBy };
}

/** CSS custom properties that recolour the admin for a white-labelled tenant. */
export function adminBrandVars(b: Brand): Record<string, string> {
  return { "--gold": b.primary, "--gold-deep": b.primary, "--brand-primary": b.primary, "--brand-accent": b.accent, "--brand-sidebar": b.sidebar, "--brand-on-primary": onColor(b.primary) };
}

/**
 * A public form's theme with the account's brand underneath: whatever the form sets stays, and anything it leaves
 * alone (header colour, button colour, logo) comes from the brand. Forms of an account with no brand are unchanged.
 */
export function brandedTheme(theme: FormTheme, b: Brand | null): FormTheme {
  if (!b?.custom) return theme;
  return { ...theme, header: theme.header ?? b.sidebar, button: theme.button ?? b.primary, logo_url: theme.logo_url ?? b.logoUrl };
}
