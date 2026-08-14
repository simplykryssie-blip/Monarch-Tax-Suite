"use client";

import { switchWorkspace } from "@/lib/workspace-actions";
import type { WorkspaceMembership } from "@/lib/workspace";

export function WorkspaceSwitcher({
  memberships,
  activeWorkspaceId,
}: {
  memberships: WorkspaceMembership[];
  activeWorkspaceId: string;
}) {
  if (memberships.length <= 1) {
    return <span className="text-sm font-medium">{memberships[0]?.workspace.name}</span>;
  }

  return (
    <form action={switchWorkspace}>
      <select
        name="workspace_id"
        defaultValue={activeWorkspaceId}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm font-medium"
      >
        {memberships.map((m) => (
          <option key={m.workspace_id} value={m.workspace_id}>
            {m.workspace.name}
          </option>
        ))}
      </select>
    </form>
  );
}
