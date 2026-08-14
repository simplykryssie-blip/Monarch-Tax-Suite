import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { toggleTaskComplete } from "./actions";
import { requireActiveWorkspace } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";

function formatDate(value: string | null) {
  if (!value) return "No due date";
  return new Date(value).toLocaleDateString();
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  const { show } = await searchParams;
  const showCompleted = show === "completed";
  const { workspace } = await requireActiveWorkspace();
  const supabase = await createClient();

  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, title, status, due_date, engagement:engagements(id, case_type, client:clients(business_name, first_name, last_name))")
    .eq("workspace_id", workspace!.id)
    .eq("status", showCompleted ? "completed" : "pending")
    .order("due_date", { ascending: true, nullsFirst: false });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Tasks</h1>
        <div className="flex gap-2">
          <Link href="/tasks">
            <Button variant={showCompleted ? "secondary" : "primary"} size="sm">
              Open
            </Button>
          </Link>
          <Link href="/tasks?show=completed">
            <Button variant={showCompleted ? "primary" : "secondary"} size="sm">
              Completed
            </Button>
          </Link>
        </div>
      </div>

      {tasks && tasks.length > 0 ? (
        <Card>
          <CardContent className="divide-y divide-border">
            {tasks.map((t) => {
              const engagement = t.engagement;
              const client = engagement?.client;
              const clientName = client
                ? client.business_name || `${client.first_name ?? ""} ${client.last_name ?? ""}`.trim()
                : null;

              return (
                <div key={t.id} className="flex items-center justify-between py-2.5">
                  <div>
                    <p className={`text-sm font-medium ${showCompleted ? "line-through text-muted" : ""}`}>
                      {t.title}
                    </p>
                    <p className="text-xs text-muted">
                      {formatDate(t.due_date)}
                      {clientName && engagement && (
                        <>
                          {" · "}
                          <Link href={`/engagements/${engagement.id}`} className="hover:text-accent hover:underline">
                            {clientName}
                          </Link>
                        </>
                      )}
                    </p>
                  </div>
                  <form action={toggleTaskComplete}>
                    <input type="hidden" name="task_id" value={t.id} />
                    <input type="hidden" name="next_status" value={showCompleted ? "pending" : "completed"} />
                    <Button type="submit" size="sm" variant="secondary">
                      {showCompleted ? "Reopen" : "Mark done"}
                    </Button>
                  </form>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : (
        <EmptyState
          title={showCompleted ? "No completed tasks yet" : "No open tasks"}
          description={showCompleted ? undefined : "Tasks added to a case will show up here."}
        />
      )}
    </div>
  );
}
