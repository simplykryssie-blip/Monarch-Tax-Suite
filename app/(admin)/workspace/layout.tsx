import { requireAdmin } from "@/lib/admin";
import { SubTabs } from "@/components/admin/subtabs";

const TABS = [["/workspace/clients", "Clients"], ["/workspace/work", "Returns"], ["/workspace/billing", "Billing"]] as const;

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <>
      <SubTabs tabs={TABS} label="Workspace" />
      {children}
    </>
  );
}
