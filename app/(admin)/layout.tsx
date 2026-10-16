import { AdminShell } from "@/components/admin/shell";
import { requireAdmin } from "@/lib/admin";
import { loadAlerts } from "@/lib/attention";
import { allows, sectionOf } from "@/lib/tier.ts";
import { currentTier } from "@/lib/tier-server";
import { tenantBrand } from "@/lib/platform-brand";
import { currentTenantId } from "@/lib/tenants.ts";
import { documentDeps } from "@/lib/documents/server";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  const tier = await currentTier();
  const tenantId = currentTenantId();
  const profile = await documentDeps().repo.getProfile().catch(() => null);
  const tenant = tenantBrand(tenantId, profile?.display_name);
  // Alerts about parts of the app this tier doesn't have would lead nowhere.
  const alerts = (await loadAlerts().catch(() => [])).filter((a) => { const section = sectionOf(a.href.split(/[?#]/)[0]); return !section || allows(tier, section); });
  return <AdminShell email={admin.email} tier={tier} alerts={alerts} tenant={tenant} today={new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "America/Chicago" }).format(new Date())}>{children}</AdminShell>;
}
