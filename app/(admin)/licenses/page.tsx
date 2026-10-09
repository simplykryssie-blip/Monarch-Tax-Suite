import Link from "next/link";
import { commerceRepo, requireAdmin } from "@/lib/admin";
import { Badge, EmptyRow, load, PageTitle, SetupRequired, when } from "@/components/admin/ui";

export default async function LicensesPage() {
  await requireAdmin();
  const repo = commerceRepo();
  const result = await load(async () => {
    const [licenses, customers, products] = await Promise.all([repo.listLicenses(), repo.listCustomers(), repo.listProducts()]);
    return { licenses, customers: new Map(customers.map((c) => [c.id, c])), products: new Map(products.map((p) => [p.id, p])) };
  });
  return (
    <>
      <PageTitle title="Licenses">Software access from verified purchases: keys, status, and authorized domains.</PageTitle>
      {!result.ok ? (
        <SetupRequired message={result.message} />
      ) : (
        <section className="monarch-panel">
          <div className="monarch-table-wrap">
            <table>
              <thead><tr><th>LICENSE</th><th>CUSTOMER</th><th>PRODUCT</th><th>STATUS</th><th>ISSUED</th><th>ACTIVATED</th></tr></thead>
              <tbody>
                {result.data.licenses.length === 0 ? (
                  <EmptyRow colSpan={6}>No licenses yet. A pending license is created for each verified purchase of a license-based product.</EmptyRow>
                ) : (
                  result.data.licenses.map((l) => (
                    <tr key={l.id}>
                      <td><Link href={`/licenses/${l.id}`}><b>{l.key_prefix ? `${l.key_prefix}…` : "Key not issued"}</b></Link></td>
                      <td>{result.data.customers.get(l.customer_id)?.email}</td>
                      <td>{result.data.products.get(l.product_id)?.name}</td>
                      <td><Badge value={l.status} /></td>
                      <td>{when(l.issued_at)}</td>
                      <td>{when(l.activated_at)}</td>
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
