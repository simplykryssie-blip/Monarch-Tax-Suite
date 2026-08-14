import Link from "next/link";
import { notFound } from "next/navigation";
import { addEngagementNote, addEngagementTask, updateCaseStatus } from "../actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/field";
import { TaskRow } from "@/components/task-row";
import { StatusSelect } from "@/components/status-select";
import { CASE_STATUSES, caseTypeLabel } from "@/lib/case-types";
import { requireActiveWorkspace } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
}

export default async function EngagementDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { workspace } = await requireActiveWorkspace();
  const supabase = await createClient();

  const { data: engagement } = await supabase
    .from("engagements")
    .select("*, client:clients(id, first_name, last_name, business_name)")
    .eq("workspace_id", workspace!.id)
    .eq("id", id)
    .single();

  if (!engagement) notFound();

  const [{ data: taxDetails }, { data: tasks }, { data: notes }] = await Promise.all([
    engagement.case_type === "tax_return"
      ? supabase.from("engagement_tax_details").select("*").eq("engagement_id", id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("tasks")
      .select("id, title, status, due_date")
      .eq("workspace_id", workspace!.id)
      .eq("engagement_id", id)
      .order("due_date", { ascending: true, nullsFirst: false }),
    supabase
      .from("notes")
      .select("id, body, created_at")
      .eq("workspace_id", workspace!.id)
      .eq("entity_type", "engagement")
      .eq("entity_id", id)
      .order("created_at", { ascending: false }),
  ]);

  const client = engagement.client;
  const clientName = client
    ? client.business_name || `${client.first_name ?? ""} ${client.last_name ?? ""}`.trim()
    : "Unknown client";

  return (
    <div className="space-y-6">
      <div>
        <Link href={client ? `/clients/${client.id}` : "/clients"} className="text-sm text-accent hover:underline">
          ← {clientName}
        </Link>
        <div className="mt-1 flex items-center justify-between">
          <h1 className="text-lg font-semibold">{caseTypeLabel(engagement.case_type)}</h1>
          <form action={updateCaseStatus} className="flex items-center gap-2">
            <input type="hidden" name="engagement_id" value={engagement.id} />
            <StatusSelect name="status" defaultValue={engagement.status} options={CASE_STATUSES} />
          </form>
        </div>
        <p className="text-sm text-muted">Due {formatDate(engagement.due_date)}</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {engagement.case_type === "tax_return" && taxDetails && (
            <Card>
              <CardHeader>
                <CardTitle>Tax details</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4 text-sm">
                <p>
                  <span className="text-muted">Tax year:</span> {taxDetails.tax_year ?? "—"}
                </p>
                <p>
                  <span className="text-muted">Return type:</span> {taxDetails.return_type ?? "—"}
                </p>
                <p>
                  <span className="text-muted">Filing status:</span> {taxDetails.filing_status ?? "—"}
                </p>
                <p>
                  <span className="text-muted">E-file status:</span> {taxDetails.efile_status}
                </p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Tasks</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <form action={addEngagementTask} className="flex gap-2">
                <input type="hidden" name="engagement_id" value={engagement.id} />
                <Input name="title" placeholder="Add a task…" required className="flex-1" />
                <Input name="due_date" type="date" className="w-auto" />
                <Button type="submit" size="sm" variant="secondary">
                  Add
                </Button>
              </form>

              {tasks && tasks.length > 0 ? (
                <div className="divide-y divide-border border-t border-border">
                  {tasks.map((t) => (
                    <TaskRow key={t.id} task={t} showStatus={false} />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted">No tasks yet.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Notes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <form action={addEngagementNote} className="space-y-2">
                <input type="hidden" name="engagement_id" value={engagement.id} />
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
      </div>
    </div>
  );
}
