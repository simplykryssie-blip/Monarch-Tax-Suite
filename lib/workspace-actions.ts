"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "./supabase/server";
import { requireUser } from "./workspace";

export async function switchWorkspace(formData: FormData) {
  const workspaceId = String(formData.get("workspace_id") ?? "");
  if (!workspaceId) return;

  const user = await requireUser();
  const supabase = await createClient();
  await supabase
    .from("user_profiles")
    .update({ default_workspace_id: workspaceId })
    .eq("id", user.id);

  revalidatePath("/", "layout");
}
