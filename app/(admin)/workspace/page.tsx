import { requireAdmin } from "@/lib/admin";
import { Flash, load, PageTitle, SetupRequired } from "@/components/admin/ui";
import { loadSnapshot } from "@/lib/efin/service";
import { WorkspaceView } from "./view";

/**
 * My Workspace: your own EFIN, the partner EROs attached to it, and every PTIN working under them. PTINs are added here.
 * Software and service clients are not listed: no team or PTINs are kept for them.
 */
export default async function Workspace({ searchParams }: { searchParams: Promise<{ add?: string; notice?: string; error?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const result = await load(loadSnapshot);
  return (
    <>
      <PageTitle title="My Workspace">Your own EFIN, the partner EROs attached to it, and the PTINs working under them. Recording a PTIN here never authorizes e-file by itself.</PageTitle>
      <Flash notice={sp.notice} error={sp.error} />
      {!result.ok ? <SetupRequired message={result.message} module="efin" /> : <WorkspaceView s={result.data} open={sp.add === "1"} />}
    </>
  );
}
