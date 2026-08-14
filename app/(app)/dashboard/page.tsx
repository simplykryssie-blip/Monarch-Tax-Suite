import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { requireActiveWorkspace } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";

const OPEN_STATUSES = [
  "New",
  "Waiting On Client",
  "Waiting On Staff",
  "In Progress",
  "Waiting On Review",
  "Corrections Requested",
  "Approved",
  "Waiting On Signature",
  "Waiting On Payment",
  "Ready To Release",
];

function StatCard({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <Link href={href}>
      <Card className="transition-colors hover:border-accent">
        <CardContent>
          <p className="text-sm text-muted">{label}</p>
          <p className="mt-2 text-3xl font-semibold">{value}</p>
        </CardContent>
      </Card>
    </Link>
  );
}

export default async function DashboardPage() {
  const { workspace } = await requireActiveWorkspace();
  const supabase = await createClient();

  const weekFromNow = new Date();
  weekFromNow.setDate(weekFromNow.getDate() + 7);

  const [openCases, tasksDue, recentClients] = await Promise.all([
    supabase
      .from("engagements")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspace!.id)
      .in("status", OPEN_STATUSES),
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspace!.id)
      .neq("status", "completed")
      .lte("due_date", weekFromNow.toISOString()),
    supabase
      .from("clients")
      .select("id, first_name, last_name, business_name, client_type, created_at")
      .eq("workspace_id", workspace!.id)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Dashboard</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Open cases" value={openCases.count ?? 0} href="/engagements" />
        <StatCard label="Tasks due this week" value={tasksDue.count ?? 0} href="/tasks" />
        <StatCard label="Clients" value={recentClients.data?.length ?? 0} href="/clients" />
      </div>

      <Card>
        <CardContent>
          <h2 className="mb-3 text-sm font-semibold">Recently added clients</h2>
          {recentClients.data && recentClients.data.length > 0 ? (
            <ul className="divide-y divide-border">
              {recentClients.data.map((c) => (
                <li key={c.id} className="flex items-center justify-between py-2.5">
                  <Link href={`/clients/${c.id}`} className="text-sm font-medium hover:text-accent">
                    {c.business_name || `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "Unnamed client"}
                  </Link>
                  <StatusPill status={c.client_type} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">
              No clients yet.{" "}
              <Link href="/clients" className="text-accent hover:underline">
                Add your first client
              </Link>
              .
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
