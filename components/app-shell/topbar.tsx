import { signOut } from "@/lib/auth-actions";
import { Button } from "@/components/ui/button";
import { WorkspaceSwitcher } from "./workspace-switcher";
import type { WorkspaceMembership } from "@/lib/workspace";

export function Topbar({
  memberships,
  activeWorkspaceId,
  userEmail,
}: {
  memberships: WorkspaceMembership[];
  activeWorkspaceId: string;
  userEmail: string;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-5">
      <WorkspaceSwitcher memberships={memberships} activeWorkspaceId={activeWorkspaceId} />
      <div className="flex items-center gap-4">
        <span className="text-sm text-muted">{userEmail}</span>
        <form action={signOut}>
          <Button type="submit" variant="secondary" size="sm">
            Sign out
          </Button>
        </form>
      </div>
    </header>
  );
}
