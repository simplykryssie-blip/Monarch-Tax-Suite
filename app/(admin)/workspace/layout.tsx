import { requireAdmin } from "@/lib/admin";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return <>{children}</>;
}
