"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { WORKSPACE_COOKIE, workspaceMemberships } from "@/lib/workspace-session";
import { chooseWorkspace, workspacesOpenToAll } from "@/lib/workspace-tenant.ts";

/** Preview only: chooses which of the signed-in person's own workspaces to work in. Anything that isn't one of theirs is ignored. */
export async function switchWorkspaceAction(form: FormData) {
  const admin = await requireAdmin();
  const wanted = typeof form.get("tenant") === "string" ? (form.get("tenant") as string) : "";
  if (workspacesOpenToAll()) {
    const memberships = await workspaceMemberships(admin.userId);
    const ok = chooseWorkspace({ platformAdmin: false, memberships, preferred: wanted });
    if (ok && ok.tenantId === wanted) (await cookies()).set(WORKSPACE_COOKIE, wanted, { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 60 * 60 * 24 * 30 });
  }
  redirect("/");
}
