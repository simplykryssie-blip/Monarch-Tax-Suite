import Link from "next/link";
import { commerceRepo, requireAdmin, serviceOrdersRepo } from "@/lib/admin";
import { SERVICE_STATUS_LABELS, serviceNextStep } from "@/lib/commerce/service-orders.ts";
import { MONARCH_TENANT_ID } from "@/lib/tenants";
import { EmptyRow, Flash, load, PageTitle, SetupRequired, when } from "@/components/admin/ui";
import { ArchiveRowButton, ArchiveTabs } from "@/components/admin/archive";
import { inView, viewCounts, viewOf } from "@/lib/archive.ts";

export default async function ServiceOrdersPage({ searchParams }: { searchParams: Promise<{ view?: string; notice?: string; error?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const view = viewOf(sp.view);
  const result = await load(async () => {
    const [serviceOrders, customers, products, orders] = await Promise.all([serviceOrdersRepo().listServiceOrders(MONARCH_TENANT_ID), commerceRepo().listCustomers(), commerceRepo().listProducts(), commerceRepo().listOrders()]);
    return { serviceOrders, customers: new Map(customers.map((c) => [c.id, c])), products: new Map(products.map((p) => [p.id, p])), orders: new Map(orders.map((o) => [o.id, o])) };
  });
  return (
    <>
      <PageTitle title="Service orders">Every paid service: what was promised, who owns it, and the next step. Open ones first.</PageTitle>
      <Flash notice={sp.notice} error={sp.error} />
      {!result.ok ? (
        <SetupRequired message={result.message} />
      ) : (
        <section className="monarch-panel">
          <div style={{ padding: "0 20px" }}><ArchiveTabs base="/service-orders" view={view} counts={viewCounts(result.data.serviceOrders)} /></div>
          <div className="monarch-table-wrap">
            <table>
              <thead><tr><th>ORDER</th><th>CUSTOMER</th><th>SERVICE</th><th>OWNER</th><th>STATUS</th><th>NEXT STEP</th><th>{view === "archived" ? "ARCHIVED" : "OPENED"}</th>{view === "archived" && <th />}</tr></thead>
              <tbody>
                {inView(result.data.serviceOrders, view).length === 0 ? (
                  <EmptyRow colSpan={view === "archived" ? 8 : 7}>{view === "archived" ? "No archived service orders." : "No service orders yet. One is created for each paid service purchase."}</EmptyRow>
                ) : (
                  [...inView(result.data.serviceOrders, view)]
                    .sort((a, b) => Number(a.status === "delivered" || a.status === "canceled") - Number(b.status === "delivered" || b.status === "canceled"))
                    .map((so) => {
                      const c = result.data.customers.get(so.customer_id);
                      return (
                        <tr key={so.id}>
                          <td><Link href={`/service-orders/${so.id}`}><b>#{result.data.orders.get(so.order_id)?.order_number}</b></Link></td>
                          <td>{c?.full_name ?? c?.email}<small className="monarch-subcell">{c?.email}</small></td>
                          <td>{result.data.products.get(so.product_id)?.name}</td>
                          <td>{so.owner}</td>
                          <td>{SERVICE_STATUS_LABELS[so.status]}</td>
                          <td>{serviceNextStep(so).text}</td>
                          <td>{view === "archived" ? when(so.archived_at ?? null) : when(so.created_at)}</td>
                          {view === "archived" && <td><ArchiveRowButton entity="service_order" id={so.id} archived back="/service-orders?view=archived" /></td>}
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
