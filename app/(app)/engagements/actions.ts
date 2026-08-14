"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireActiveWorkspace } from "@/lib/workspace";

export async function createCase(formData: FormData) {
  const { workspace } = await requireActiveWorkspace();
  if (!workspace) return;

  const clientId = String(formData.get("client_id") ?? "");
  const caseType = String(formData.get("case_type") ?? "other");
  const dueDate = String(formData.get("due_date") ?? "");
  const taxYear = String(formData.get("tax_year") ?? "");

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("engagements")
    .insert({
      workspace_id: workspace.id,
      client_id: clientId,
      case_type: caseType,
      due_date: dueDate || null,
      status: "New",
    })
    .select("id")
    .single();

  if (error || !data) {
    redirect(`/engagements/new?client_id=${clientId}&error=${encodeURIComponent(error?.message ?? "Could not create case")}`);
  }

  if (caseType === "tax_return" && taxYear) {
    await supabase.from("engagement_tax_details").insert({
      engagement_id: data.id,
      workspace_id: workspace.id,
      tax_year: Number(taxYear),
    });
  }

  revalidatePath("/engagements");
  redirect(`/engagements/${data.id}`);
}

export async function updateCaseStatus(formData: FormData) {
  const { workspace } = await requireActiveWorkspace();
  if (!workspace) return;

  const engagementId = String(formData.get("engagement_id") ?? "");
  const status = String(formData.get("status") ?? "");

  const supabase = await createSupabaseClient();
  await supabase
    .from("engagements")
    .update({ status })
    .eq("id", engagementId)
    .eq("workspace_id", workspace.id);

  revalidatePath(`/engagements/${engagementId}`);
  revalidatePath("/engagements");
}

export async function addEngagementNote(formData: FormData) {
  const { workspace, user } = await requireActiveWorkspace();
  if (!workspace) return;

  const engagementId = String(formData.get("engagement_id") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!body) return;

  const supabase = await createSupabaseClient();
  await supabase.from("notes").insert({
    workspace_id: workspace.id,
    entity_type: "engagement",
    entity_id: engagementId,
    author_id: user.id,
    body,
  });

  revalidatePath(`/engagements/${engagementId}`);
}

export async function addEngagementTask(formData: FormData) {
  const { workspace } = await requireActiveWorkspace();
  if (!workspace) return;

  const engagementId = String(formData.get("engagement_id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const dueDate = String(formData.get("due_date") ?? "");
  if (!title) return;

  const supabase = await createSupabaseClient();
  await supabase.from("tasks").insert({
    workspace_id: workspace.id,
    engagement_id: engagementId,
    title,
    due_date: dueDate || null,
  });

  revalidatePath(`/engagements/${engagementId}`);
}
