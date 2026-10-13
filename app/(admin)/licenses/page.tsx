import Link from "next/link";
import { commerceRepo, requireAdmin } from "@/lib/admin";
import { Badge, EmptyRow, Flash, load, PageTitle, SetupRequired, when } from "@/components/admin/ui";
import { ArchiveRowButton, ArchiveTabs } from "@/components/admin/archive";
import { inView, viewCounts, viewOf } from "@/lib/archive.ts";

export default async function LicensesPage({ searchParams }: { searchParams: Promise<{ view?: string; notice?: string; error?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const view = viewOf(sp.view);
  const repo = commerceRepo();
  const result = await load(async () => {
    const [licenses, customers, products] = await Promise.all([repo.listLicenses(), repo.listCustomers(), repo.listProducts()]);
    return { licenses, customers: new Map(customers.map((c) => [c.id, c])), products: new Map(products.map((p) => [p.id, p])) };
  });
  return (
    <>
      <PageTitle title="Licenses">Software access from verified purchases: keys, status, and authorized domains.</PageTitle>
      <Flash notice={sp.notice} error={sp.error} />
      {!result.ok ? (
        <SetupRequired message={result.message} />
      ) : (
        <section className="monarch-panel">
          <div style={{ padding: "0 20px" }}><ArchiveTabs base="/licenses" view={view} counts={viewCounts(result.data.licenses)} /></div>
          <div className="monarch-table-wrap">
            <table>
              <thead><tr><th>LICENSE</th><th>CUSTOMER</th><th>PRODUCT</th><th>STATUS</th><th>ISSUED</th><th>{view === "archived" ? "ARCHIVED" : "ACTIVATED"}</th>{view === "archived" && <th />}</tr></thead>
              <tbody>
                {inView(result.data.licenses, view).length === 0 ? (
                  <EmptyRow colSpan={view === "archived" ? 7 : 6}>{view === "archived" ? "No archived licenses." : "No licenses yet. A pending license is created for each verified purchase of a license-based product."}</EmptyRow>
                ) : (
                  inView(result.data.licenses, view).map((l) => (
                    <tr key={l.id}>
                      <td><Link href={`/licenses/${l.id}`}><b>{l.key_prefix ? `${l.key_prefix}…` : "Key not issued"}</b></Link></td>
                      <td>{result.data.customers.get(l.customer_id)?.email}</td>
                      <td>{result.data.products.get(l.product_id)?.name}</td>
                      <td><Badge value={l.status} /></td>
                      <td>{when(l.issued_at)}</td>
                      <td>{view === "archived" ? when(l.archived_at ?? null) : when(l.activated_at)}</td>
                      {view === "archived" && <td><ArchiveRowButton entity="license" id={l.id} archived back="/licenses?view=archived" /></td>}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
