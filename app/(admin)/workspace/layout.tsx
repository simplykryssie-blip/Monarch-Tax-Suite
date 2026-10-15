import { requireAdmin } from "@/lib/admin";
import { SubTabs } from "@/components/admin/subtabs";

const TABS = [["/workspace", "My Tax Office"], ["/workspace/clients", "My Clients"], ["/workspace/work", "My Work"], ["/workspace/billing", "Billing"]] as const;

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <>
      <SubTabs tabs={TABS} label="My Workspace" />
      {children}
    </>
  );
}
