import { headers } from "next/headers";
import { AdminShell } from "@/components/admin/shell";
import { PlatformShell } from "@/components/admin/platform-shell";
import { isPlatformAdmin, onAdminHost, requireAdmin, requirePlatformAdmin } from "@/lib/admin";
import { adminHosts, adminSeparationOn } from "@/lib/admin-host.ts";
import { loadAlerts } from "@/lib/attention";
import { loadBell } from "@/lib/notifications/server";
import { allows, sectionOf } from "@/lib/tier.ts";
import { currentTier } from "@/lib/tier-server";
import { loadBrand } from "@/lib/branding/server";
import { PLATFORM } from "@/lib/platform-brand";
import type { Metadata } from "next";
import { currentTenantId, MONARCH_TENANT_ID } from "@/lib/tenants.ts";

/** Tab title and icon: the platform's, or the account's own when it white-labels its admin. */
export async function generateMetadata(): Promise<Metadata> {
  const brand = await loadBrand(currentTenantId());
  if (!brand.whiteLabelAdmin) return {};
  return {
    title: { default: `${brand.name} | Admin Workspace`, template: `%s | ${brand.name}` },
    description: brand.tagline ?? `${brand.name} workspace`,
    ...(brand.markUrl ? { icons: { icon: brand.markUrl, apple: brand.markUrl } } : {}),
    openGraph: { siteName: brand.name, images: brand.logoUrl ? [brand.logoUrl] : [PLATFORM.ogImage] },
  };
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Verexa HQ's own pages (/admin) get the platform's frame, not a workspace's: no workspace menu, brand or alerts. The frame is
  // drawn only for a platform administrator: checking the workspace gate here would let a workspace member see its outline
  // for a moment before the page itself turned them away.
  const path = (await headers()).get("x-pathname") ?? "";
  if (path === "/admin" || path.startsWith("/admin/")) {
    const platform = await requirePlatformAdmin();
    return <PlatformShell email={platform.email}>{children}</PlatformShell>;
  }
  const admin = await requireAdmin();
  const tier = await currentTier();
  const brand = await loadBrand(currentTenantId());
  // Alerts about parts of the app this tier doesn't have would lead nowhere.
  const alerts = (await onAdminHost() ? [] : await loadAlerts().catch(() => [])).filter((a) => { const section = sectionOf(a.href.split(/[?#]/)[0]); return !section || allows(tier, section); });
  const bell = await onAdminHost() ? { items: [], unread: 0 } : await loadBell(admin.userId);
  // Separated: the Admin menu belongs to the admin address alone (and that address shows nothing else). Not yet separated: as before.
  const adminHost = await onAdminHost();
  const platformAdmin = adminSeparationOn() ? adminHost && (await isPlatformAdmin()) : await isPlatformAdmin();
  // Inside the Monarch workspace the Admin entry is a link to the platform admin's own address (when that address is set up).
  const adminLink = !adminHost && currentTenantId() === MONARCH_TENANT_ID && adminHosts().length > 0 ? `https://${adminHosts().find((h) => h.startsWith("admin.")) ?? adminHosts()[0]}` : null;
  return <AdminShell email={admin.email} tier={tier} platformAdmin={platformAdmin} adminOnly={adminHost} adminLink={adminLink} alerts={alerts} bell={bell} brand={brand} today={new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "America/Chicago" }).format(new Date())}>{children}</AdminShell>;
}
