import { createCase } from "../actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/field";
import { CASE_TYPES } from "@/lib/case-types";
import { requireActiveWorkspace } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";

export default async function NewCasePage({
  searchParams,
}: {
  searchParams: Promise<{ client_id?: string; error?: string }>;
}) {
  const { client_id, error } = await searchParams;
  const { workspace } = await requireActiveWorkspace();
  const supabase = await createClient();

  const { data: clients } = await supabase
    .from("clients")
    .select("id, first_name, last_name, business_name")
    .eq("workspace_id", workspace!.id)
    .order("created_at", { ascending: false });

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-lg font-semibold">New case</h1>

      <Card>
        <CardContent>
          <form action={createCase} className="space-y-4">
            <div>
              <Label htmlFor="client_id">Client</Label>
              <Select id="client_id" name="client_id" defaultValue={client_id ?? ""} required>
                <option value="" disabled>
                  Select a client…
                </option>
                {clients?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.business_name || `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim()}
                  </option>
                ))}
              </Select>
              {(!clients || clients.length === 0) && (
                <p className="mt-1 text-xs text-muted">No clients yet — add a client first.</p>
              )}
            </div>

            <div>
              <Label htmlFor="case_type">Case type</Label>
              <Select id="case_type" name="case_type" defaultValue="tax_return">
                {CASE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="due_date">Due date</Label>
                <Input id="due_date" name="due_date" type="date" />
              </div>
              <div>
                <Label htmlFor="tax_year">Tax year (if applicable)</Label>
                <Input id="tax_year" name="tax_year" type="number" placeholder="2025" />
              </div>
            </div>

            {error && <p className="rounded-md bg-danger-muted px-3 py-2 text-sm text-danger">{error}</p>}

            <Button type="submit">Create case</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
