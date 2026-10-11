import { existsSync } from "node:fs";
import { join } from "node:path";
import { AdminShell } from "@/components/admin/shell";
import { requireAdmin } from "@/lib/admin";
import { loadAlerts } from "@/lib/attention";

// The owner's logo: drop it at public/brand/logo.(svg|png|webp) and it replaces the drawn placeholder mark.
function logoSrc() {
  for (const ext of ["svg", "png", "webp"]) if (existsSync(join(process.cwd(), "public", "brand", `logo.${ext}`))) return `/brand/logo.${ext}`;
  return null;
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  const alerts = await loadAlerts().catch(() => []);
  return <AdminShell email={admin.email} alerts={alerts} logoSrc={logoSrc()} today={new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "America/Chicago" }).format(new Date())}>{children}</AdminShell>;
}
