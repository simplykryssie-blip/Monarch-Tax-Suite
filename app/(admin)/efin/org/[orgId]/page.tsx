import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { Flash, load, SetupRequired } from "@/components/admin/ui";
import { loadSnapshot } from "@/lib/efin/service";
import { EroAdmin } from "../../ero-admin";
import { FirmHeader } from "../../firm-card";
import { nextSteps } from "@/lib/efin/steps.ts";
import { AddEfinForm } from "../../add-efin-form";

/** An ERO that has no EFIN yet (or whose EFINs are all elsewhere): edit it, delete it, or add its first EFIN. */
export default async function EroPage({ params, searchParams }: { params: Promise<{ orgId: string }>; searchParams: Promise<{ edit?: string; notice?: string; error?: string }> }) {
  await requireAdmin();
  const { orgId } = await params;
  const sp = await searchParams;
  const result = await load(loadSnapshot);
  if (!result.ok) return <SetupRequired message={result.message} />;
  const org = result.data.orgs.find((o) => o.id === orgId);
  if (!org) notFound();
  const first = result.data.efins.find((e) => e.organization_id === orgId && !e.archived_at);
  return (
    <>
      <FirmHeader s={result.data} org={org} steps={nextSteps({ org, assignments: result.data.assignments, filings: result.data.filings })} base={`/efin/org/${orgId}`} />
      <Flash {...sp} />
      <div className="efin-flow" id="manage">
        {!org.archived_at && (
          <details className="efin-edit" open={!first || sp.edit === "efin"}>
            <summary>Add an EFIN</summary>
            <div className="efin-edit-body"><AddEfinForm s={result.data} org={org} back={`/efin/org/${orgId}`} /></div>
          </details>
        )}
        <EroAdmin s={result.data} org={org} back={`/efin/org/${orgId}`} openSection={sp.edit} />
      </div>
    </>
  );
}
