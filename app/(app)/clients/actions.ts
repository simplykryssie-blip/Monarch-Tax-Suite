"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireActiveWorkspace } from "@/lib/workspace";

export async function createClientRecord(formData: FormData) {
  const { workspace } = await requireActiveWorkspace();
  if (!workspace) return;

  const clientType = String(formData.get("client_type") ?? "individual");
  const firstName = String(formData.get("first_name") ?? "").trim();
  const lastName = String(formData.get("last_name") ?? "").trim();
  const businessName = String(formData.get("business_name") ?? "").trim();
  const primaryEmail = String(formData.get("primary_email") ?? "").trim();
  const primaryPhone = String(formData.get("primary_phone") ?? "").trim();

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("clients")
    .insert({
      workspace_id: workspace.id,
      client_type: clientType,
      first_name: firstName || null,
      last_name: lastName || null,
      business_name: businessName || null,
      primary_email: primaryEmail || null,
      primary_phone: primaryPhone || null,
    })
    .select("id")
    .single();

  if (error || !data) {
    redirect(`/clients/new?error=${encodeURIComponent(error?.message ?? "Could not create client")}`);
  }

  revalidatePath("/clients");
  redirect(`/clients/${data.id}`);
}

export async function addClientNote(formData: FormData) {
  const { workspace, user } = await requireActiveWorkspace();
  if (!workspace) return;

  const clientId = String(formData.get("client_id") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!body) return;

  const supabase = await createSupabaseClient();
  await supabase.from("notes").insert({
    workspace_id: workspace.id,
    entity_type: "client",
    entity_id: clientId,
    author_id: user.id,
    body,
  });

  revalidatePath(`/clients/${clientId}`);
}
