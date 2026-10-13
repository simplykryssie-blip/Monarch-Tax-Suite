import { requireAdmin } from "@/lib/admin";
import { PageTitle } from "@/components/admin/ui";
import { IMPORT_MAX_ROWS } from "@/lib/leads/service.ts";
import { ImportForm } from "./import-form";

export default async function ImportLeadsPage() {
  await requireAdmin();
  return (
    <>
      <PageTitle title="Import leads" back={{ href: "/leads", label: "Leads" }}>
        Save your spreadsheet as CSV. The first row names the columns: <b>Name</b> and <b>Email</b> are required; <b>Phone</b>, <b>Firm</b>, <b>Source</b>,
        <b> Status</b>, <b>Notes</b> and <b>Last contacted</b> are optional, and other columns are ignored. A file from Export CSV imports as is.
        An email that is already a lead is skipped, never overwritten. Up to {IMPORT_MAX_ROWS.toLocaleString("en-US")} rows at a time.
      </PageTitle>
      <ImportForm />
    </>
  );
}
