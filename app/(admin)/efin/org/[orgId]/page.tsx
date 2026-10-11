import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { Flash, load, PageTitle, SetupRequired } from "@/components/admin/ui";
import { loadSnapshot } from "@/lib/efin/service";
import { EroAdmin } from "../../ero-admin";

/** An ERO that has no EFIN yet (or whose EFINs are all elsewhere): edit it, delete it, or add its first EFIN. */
export default async function EroPage({ params, searchParams }: { params: Promise<{ orgId: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
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
      <PageTitle title={org.legal_name} back={{ href: "/efin/list", label: "EROs & EFINs" }}>{org.archived_at ? "Archived. " : ""}{first ? "" : "No EFIN recorded yet. "}{first && <Link href={`/efin/${first.id}`}>Open its EFIN</Link>}</PageTitle>
      <Flash {...sp} />
      {!org.archived_at && <div className="monarch-notice"><b>NEXT</b> <Link href="/efin/add">Add an EFIN</Link> for this ERO.</div>}
      <EroAdmin s={result.data} org={org} back={`/efin/org/${orgId}`} />
    </>
  );
}
