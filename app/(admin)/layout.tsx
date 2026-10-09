import { AdminShell } from "@/components/admin/shell";
import { requireAdmin } from "@/lib/admin";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  return <AdminShell email={admin.email}>{children}</AdminShell>;
}
