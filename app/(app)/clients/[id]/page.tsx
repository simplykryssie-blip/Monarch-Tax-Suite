import Link from "next/link";
import { notFound } from "next/navigation";
import { addClientNote } from "../actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { Textarea } from "@/components/ui/field";
import { requireActiveWorkspace } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
}

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { workspace } = await requireActiveWorkspace();
  const supabase = await createClient();

  const { data: client } = await supabase
    .from("clients")
    .select("*")
    .eq("workspace_id", workspace!.id)
    .eq("id", id)
    .single();

  if (!client) notFound();

  const [{ data: engagements }, { data: notes }] = await Promise.all([
    supabase
      .from("engagements")
      .select("id, case_type, status, due_date, open_date")
      .eq("workspace_id", workspace!.id)
      .eq("client_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("notes")
      .select("id, body, created_at")
      .eq("workspace_id", workspace!.id)
      .eq("entity_type", "client")
      .eq("entity_id", id)
      .order("created_at", { ascending: false }),
  ]);

  const name = client.business_name || `${client.first_name ?? ""} ${client.last_name ?? ""}`.trim() || "Unnamed client";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">{name}</h1>
          <p className="text-sm text-muted capitalize">{client.client_type} · {client.lifecycle_status}</p>
        </div>
        <Link href={`/engagements/new?client_id=${client.id}`}>
          <Button>New case</Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Cases</CardTitle>
            </CardHeader>
            <CardContent>
              {engagements && engagements.length > 0 ? (
                <ul className="divide-y divide-border -mx-5">
                  {engagements.map((e) => (
                    <li key={e.id}>
                      <Link
                        href={`/engagements/${e.id}`}
                        className="flex items-center justify-between px-5 py-2.5 hover:bg-surface-muted"
                      >
                        <div>
                          <p className="text-sm font-medium capitalize">{e.case_type.replace("_", " ")}</p>
                          <p className="text-xs text-muted">Due {formatDate(e.due_date)}</p>
                        </div>
                        <StatusPill status={e.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">No cases yet for this client.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Notes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <form action={addClientNote} className="space-y-2">
                <input type="hidden" name="client_id" value={client.id} />
                <Textarea name="body" placeholder="Add a note…" rows={2} required />
                <Button type="submit" size="sm" variant="secondary">
                  Add note
                </Button>
              </form>

              {notes && notes.length > 0 ? (
                <ul className="space-y-3 border-t border-border pt-4">
                  {notes.map((n) => (
                    <li key={n.id} className="text-sm">
                      <p>{n.body}</p>
                      <p className="mt-1 text-xs text-muted">{formatDate(n.created_at)}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">No notes yet.</p>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Contact info</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <span className="text-muted">Email:</span> {client.primary_email || "—"}
            </p>
            <p>
              <span className="text-muted">Phone:</span> {client.primary_phone || "—"}
            </p>
            <p>
              <span className="text-muted">Address:</span>{" "}
              {[client.address_line1, client.city, client.state, client.postal_code].filter(Boolean).join(", ") || "—"}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
