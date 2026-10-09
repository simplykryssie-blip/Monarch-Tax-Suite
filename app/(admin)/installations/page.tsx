import Link from "next/link";
import { commerceRepo, requireAdmin } from "@/lib/admin";
import { Badge, EmptyRow, label, load, PageTitle, SetupRequired, when } from "@/components/admin/ui";
import { PLATFORM_GUIDES } from "@/lib/commerce/platforms.ts";

export default async function InstallationsPage() {
  await requireAdmin();
  const repo = commerceRepo();
  const result = await load(async () => {
    const [installations, customers, products, orders] = await Promise.all([repo.listInstallations(), repo.listCustomers(), repo.listProducts(), repo.listOrders()]);
    return {
      installations,
      customers: new Map(customers.map((c) => [c.id, c])),
      products: new Map(products.map((p) => [p.id, p])),
      orders: new Map(orders.map((o) => [o.id, o])),
    };
  });
  return (
    <>
      <PageTitle title="Installations">Self-service and Done For You installations for verified purchases.</PageTitle>
      {!result.ok ? (
        <SetupRequired message={result.message} />
      ) : (
        <section className="monarch-panel">
          <div className="monarch-table-wrap">
            <table>
              <thead><tr><th>CUSTOMER</th><th>PRODUCT</th><th>ORDER</th><th>TYPE</th><th>PLATFORM</th><th>LOCATION</th><th>STATUS</th><th>UPDATED</th></tr></thead>
              <tbody>
                {result.data.installations.length === 0 ? (
                  <EmptyRow colSpan={8}>No installations yet. One is created for each verified purchase that includes installation.</EmptyRow>
                ) : (
                  result.data.installations.map((i) => {
                    const order = result.data.orders.get(i.order_id);
                    return (
                      <tr key={i.id}>
                        <td><Link href={`/installations/${i.id}`}><b>{result.data.customers.get(i.customer_id)?.email}</b></Link></td>
                        <td>{result.data.products.get(i.product_id)?.name}</td>
                        <td>#{order?.order_number} · <Badge value={order?.payment_status ?? "pending"} /></td>
                        <td>{label(i.installation_type)}</td>
                        <td>{PLATFORM_GUIDES[i.platform].label}{i.platform === "other" && i.platform_other ? ` — ${i.platform_other}` : ""}</td>
                        <td>{i.target_location ?? i.website_url ?? "—"}</td>
                        <td><Badge value={i.status} /></td>
                        <td>{when(i.updated_at)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
