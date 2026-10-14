import { requireSection } from "@/lib/tier-server";
import { Flash, load, PageTitle, SetupRequired } from "@/components/admin/ui";
import { loadSnapshot } from "@/lib/efin/service";
import { EroDashboard } from "./view";

/**
 * ERO Dashboard: your own EFIN and the PTINs working under it. Partner firms and everyone else's EFINs live in
 * My Service Bureau. Recording a PTIN here never authorizes e-file by itself.
 */
export default async function EroDashboardPage({ searchParams }: { searchParams: Promise<{ add?: string; notice?: string; error?: string }> }) {
  await requireSection("ero");
  const sp = await searchParams;
  const result = await load(loadSnapshot);
  return (
    <>
      <PageTitle title="ERO Dashboard">Your own EFIN and the PTINs of the people who prepare under it. Recording a PTIN here never authorizes e-file by itself.</PageTitle>
      <Flash notice={sp.notice} error={sp.error} />
      {!result.ok ? <SetupRequired message={result.message} module="efin" /> : <EroDashboard s={result.data} adding={sp.add === "1"} />}
    </>
  );
}
