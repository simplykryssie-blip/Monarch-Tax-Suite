import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireActiveWorkspace } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";

export default async function SettingsPage() {
  const { workspace, memberships } = await requireActiveWorkspace();
  const supabase = await createClient();

  const [{ data: fullWorkspace }, { data: branding }, { count: memberCount }] = await Promise.all([
    supabase.from("workspaces").select("*").eq("id", workspace!.id).single(),
    supabase.from("branding").select("*").eq("workspace_id", workspace!.id).maybeSingle(),
    supabase
      .from("workspace_users")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspace!.id)
      .eq("status", "active"),
  ]);

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-lg font-semibold">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>Workspace</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            <span className="text-muted">Name:</span> {fullWorkspace?.name}
          </p>
          <p>
            <span className="text-muted">Slug:</span> {fullWorkspace?.slug}
          </p>
          <p>
            <span className="text-muted">Type:</span> {fullWorkspace?.workspace_type}
          </p>
          <p>
            <span className="text-muted">Status:</span> {fullWorkspace?.status}
          </p>
          <p>
            <span className="text-muted">Team members:</span> {memberCount ?? 1}
          </p>
          <p>
            <span className="text-muted">Your workspaces:</span> {memberships.length}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Branding</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {branding ? (
            <>
              <p>
                <span className="text-muted">Display name:</span> {branding.display_name || fullWorkspace?.name}
              </p>
              <p>
                <span className="text-muted">Support email:</span> {branding.support_email || "—"}
              </p>
              <p>
                <span className="text-muted">Website:</span> {branding.website_url || "—"}
              </p>
            </>
          ) : (
            <p className="text-muted">No branding configured yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
