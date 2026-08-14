import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/status-pill";
import { caseTypeLabel } from "@/lib/case-types";
import { requireActiveWorkspace } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";

function formatDate(value: string | null) {
  if (!value) return "No due date";
  return new Date(value).toLocaleDateString();
}

export default async function EngagementsPage() {
  const { workspace } = await requireActiveWorkspace();
  const supabase = await createClient();

  const { data: cases } = await supabase
    .from("engagements")
    .select("id, case_type, status, due_date, client:clients(id, first_name, last_name, business_name)")
    .eq("workspace_id", workspace!.id)
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Cases</h1>
        <Link href="/engagements/new">
          <Button>New case</Button>
        </Link>
      </div>

      {cases && cases.length > 0 ? (
        <Card>
          <ul className="divide-y divide-border">
            {cases.map((c) => {
              const client = c.client;
              const clientName = client
                ? client.business_name || `${client.first_name ?? ""} ${client.last_name ?? ""}`.trim()
                : "Unknown client";
              return (
                <li key={c.id}>
                  <Link
                    href={`/engagements/${c.id}`}
                    className="flex items-center justify-between px-5 py-3 hover:bg-surface-muted"
                  >
                    <div>
                      <p className="text-sm font-medium">{clientName}</p>
                      <p className="text-sm text-muted">
                        {caseTypeLabel(c.case_type)} · {formatDate(c.due_date)}
                      </p>
                    </div>
                    <StatusPill status={c.status} />
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : (
        <EmptyState
          title="No cases yet"
          description="Open a case for a client to start tracking their work."
          action={
            <Link href="/engagements/new">
              <Button>New case</Button>
            </Link>
          }
        />
      )}
    </div>
  );
}
