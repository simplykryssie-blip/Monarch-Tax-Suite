"use server";

import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireActiveWorkspace } from "@/lib/workspace";

export async function toggleTaskComplete(formData: FormData) {
  const { workspace } = await requireActiveWorkspace();
  if (!workspace) return;

  const taskId = String(formData.get("task_id") ?? "");
  const nextStatus = String(formData.get("next_status") ?? "completed");

  const supabase = await createSupabaseClient();
  await supabase
    .from("tasks")
    .update({
      status: nextStatus,
      completed_at: nextStatus === "completed" ? new Date().toISOString() : null,
    })
    .eq("id", taskId)
    .eq("workspace_id", workspace.id);

  revalidatePath("/tasks");
  revalidatePath("/engagements", "layout");
}
