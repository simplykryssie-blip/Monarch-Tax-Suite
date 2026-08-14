import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";

export type WorkspaceMembership = {
  workspace_id: string;
  is_owner: boolean;
  workspace: { id: string; name: string; slug: string };
};

export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return user;
}

export async function getWorkspaceMemberships(userId: string): Promise<WorkspaceMembership[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workspace_users")
    .select("workspace_id, is_owner, workspace:workspaces(id, name, slug)")
    .eq("user_id", userId)
    .eq("status", "active");

  if (error || !data) return [];

  return data
    .filter((row): row is typeof row & { workspace: NonNullable<typeof row.workspace> } => row.workspace !== null)
    .map((row) => ({
      workspace_id: row.workspace_id,
      is_owner: row.is_owner,
      workspace: row.workspace,
    }));
}

export async function requireActiveWorkspace() {
  const user = await requireUser();
  const memberships = await getWorkspaceMemberships(user.id);

  if (memberships.length === 0) {
    return { user, workspace: null, memberships };
  }

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("default_workspace_id")
    .eq("id", user.id)
    .single();

  const preferred = memberships.find((m) => m.workspace_id === profile?.default_workspace_id);
  const active = preferred ?? memberships[0];

  return { user, workspace: active.workspace, memberships };
}
