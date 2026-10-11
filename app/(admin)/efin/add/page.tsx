import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { Flash, load, PageTitle, SetupRequired } from "@/components/admin/ui";
import { loadSnapshot } from "@/lib/efin/service";
import { AddEfinForm } from "../add-efin-form";

/** Direct link to add an EFIN. The normal way is "Add another EFIN" on the ERO's own page; ?org= pre-selects the ERO. */
export default async function NewEfin({ searchParams }: { searchParams: Promise<{ org?: string; notice?: string; error?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const result = await load(loadSnapshot);
  const org = result.ok ? result.data.orgs.find((o) => o.id === sp.org) : undefined;
  return (
    <>
      <PageTitle title="Add an EFIN" back={{ href: "/efin/list", label: "EROs & EFINs" }}>{org ? `For ${org.legal_name}. ` : "For an ERO already in your list. "}The number is encrypted when saved, and only the last four digits stay readable. Recording an EFIN here does not apply for, renew or verify it with the IRS.</PageTitle>
      <Flash notice={sp.notice} error={sp.error} />
      {!result.ok ? <SetupRequired message={result.message} module="efin" /> : result.data.orgs.length === 0 ? (
        <div className="monarch-notice"><b>FIRST STEP</b> Add the ERO this EFIN belongs to by choosing <Link href="/efin/new">Add an ERO</Link>.</div>
      ) : (
        <div className="efin-flow"><section className="monarch-panel monarch-pad"><AddEfinForm s={result.data} org={org} /></section></div>
      )}
    </>
  );
}
