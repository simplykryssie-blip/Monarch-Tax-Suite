import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/field";
import { requireActiveWorkspace } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const { workspace } = await requireActiveWorkspace();
  const supabase = await createClient();

  let query = supabase
    .from("clients")
    .select("id, first_name, last_name, business_name, client_type, lifecycle_status, primary_email, primary_phone")
    .eq("workspace_id", workspace!.id)
    .order("created_at", { ascending: false });

  if (q) {
    query = query.or(
      `first_name.ilike.%${q}%,last_name.ilike.%${q}%,business_name.ilike.%${q}%,primary_email.ilike.%${q}%`
    );
  }

  const { data: clients } = await query;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Clients</h1>
        <Link href="/clients/new">
          <Button>New client</Button>
        </Link>
      </div>

      <form className="max-w-sm">
        <Input type="search" name="q" placeholder="Search clients…" defaultValue={q ?? ""} />
      </form>

      {clients && clients.length > 0 ? (
        <Card>
          <ul className="divide-y divide-border">
            {clients.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/clients/${c.id}`}
                  className="flex items-center justify-between px-5 py-3 hover:bg-surface-muted"
                >
                  <div>
                    <p className="text-sm font-medium">
                      {c.business_name || `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "Unnamed client"}
                    </p>
                    <p className="text-sm text-muted">{c.primary_email || c.primary_phone || "No contact info"}</p>
                  </div>
                  <span className="text-xs uppercase tracking-wide text-muted">{c.client_type}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <EmptyState
          title={q ? "No clients match your search" : "No clients yet"}
          description={q ? undefined : "Add your first client to get started."}
          action={
            !q && (
              <Link href="/clients/new">
                <Button>New client</Button>
              </Link>
            )
          }
        />
      )}
    </div>
  );
}
