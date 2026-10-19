import Link from "next/link";
import { commerceRepo, requireAdmin } from "@/lib/admin";
import { isInternalOrder, needsReview } from "@/lib/commerce/fulfillment.ts";
import { Badge, EmptyRow, Flash, label, load, money, PageTitle, SetupRequired, when } from "@/components/admin/ui";
import { ArchiveRowButton, ArchiveTabs } from "@/components/admin/archive";
import { inView, viewCounts, viewOf } from "@/lib/archive.ts";

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ view?: string; notice?: string; error?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const view = viewOf(sp.view);
  const repo = commerceRepo();
  const result = await load(async () => {
    const [orders, customers, products] = await Promise.all([repo.listOrders(), repo.listCustomers(), repo.listProducts()]);
    // Loaded on its own so the orders list still shows before the storefront checkout migration is applied.
    const checkouts = await repo.listStorefrontCheckouts(25).catch(() => null);
    return { orders, checkouts, customers: new Map(customers.map((c) => [c.id, c])), products: new Map(products.map((p) => [p.id, p])) };
  });
  return (
    <>
      <PageTitle title="Orders">Every verified order, its payment status, and how it was verified.</PageTitle>
      <Flash notice={sp.notice} error={sp.error} />
      {!result.ok ? (
        <SetupRequired message={result.message} />
      ) : (
        <>
          <div className="monarch-page-actions">
            <span>{inView(result.data.orders, view).length} {view === "archived" ? "archived " : ""}{inView(result.data.orders, view).length === 1 ? "order" : "orders"} · new Stripe purchases are recorded automatically by the webhook</span>
            <span className="monarch-inline-actions">
              <Link className="monarch-secondary" href="/orders/internal">New internal license (no payment)</Link>
              <Link className="monarch-primary" href="/orders/reconcile">Reconcile a past purchase</Link>
            </span>
          </div>
          <section className="monarch-panel">
            <div style={{ padding: "0 20px" }}><ArchiveTabs base="/orders" view={view} counts={viewCounts(result.data.orders)} /></div>
            <div className="monarch-table-wrap">
              <table>
                <thead><tr><th>ORDER</th><th>TYPE</th><th>CUSTOMER</th><th>PRODUCT</th><th>AMOUNT</th><th>PAYMENT</th><th>INSTALLATION</th><th>VERIFIED BY</th><th>{view === "archived" ? "ARCHIVED" : "DATE"}</th>{view === "archived" && <th />}</tr></thead>
                <tbody>
                  {inView(result.data.orders, view).length === 0 ? (
                    <EmptyRow colSpan={view === "archived" ? 10 : 9}>{view === "archived" ? "No archived orders." : "No orders recorded yet."}</EmptyRow>
                  ) : (
                    inView(result.data.orders, view).map((o) => {
                      const c = result.data.customers.get(o.customer_id);
                      return (
                        <tr key={o.id}>
                          <td><Link href={`/orders/${o.id}`}><b>#{o.order_number}</b></Link></td>
                          <td>{o.order_type === "annual_update" ? `Update → ${o.tax_year}` : "Purchase"}</td>
                          <td><Link href={`/customers/${o.customer_id}`}><b>{c?.full_name ?? c?.email}</b></Link><small className="monarch-subcell">{c?.email}</small></td>
                          <td>{result.data.products.get(o.product_id)?.name}</td>
                          <td><b>{money(o.amount_cents, o.currency)}</b>{isInternalOrder(o) && <small className="monarch-subcell">Internal · no payment</small>}</td>
                          <td><Badge value={o.payment_status} />{needsReview(o) && <small className="monarch-subcell" title={o.notes ?? undefined}>Needs review · {o.notes!.slice("Review:".length).trim()}</small>}</td>
                          <td>{o.installation_type ? label(o.installation_type) : "—"}</td>
                          <td>{label(o.verification_method)}</td>
                          <td>{view === "archived" ? when(o.archived_at ?? null) : when(o.paid_at ?? o.created_at)}</td>
                          {view === "archived" && <td><ArchiveRowButton entity="order" id={o.id} archived back="/orders?view=archived" /></td>}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
          <section className="monarch-panel">
            <h2>Storefront checkouts</h2>
            <p className="monarch-muted">Every checkout started from the shop, newest first. Open checkouts that pass their expiry without payment were abandoned. The order appears above only once Stripe confirms payment.</p>
            {result.data.checkouts === null ? (
              <p className="monarch-alert is-error">Storefront checkouts are not available: apply the migration 20261013090000_storefront_checkout.sql.</p>
            ) : (
              <div className="monarch-table-wrap">
                <table>
                  <thead><tr><th>STARTED</th><th>PRODUCT</th><th>AMOUNT</th><th>STATUS</th><th>TERMS ACCEPTED</th></tr></thead>
                  <tbody>
                    {result.data.checkouts.length === 0 ? (
                      <EmptyRow colSpan={5}>No storefront checkouts yet.</EmptyRow>
                    ) : (
                      result.data.checkouts.map((c) => {
                        const abandoned = c.status === "expired" || (c.status === "open" && c.expires_at < new Date().toISOString());
                        return (
                          <tr key={c.id}>
                            <td>{when(c.created_at)}</td>
                            <td>{result.data.products.get(c.product_id)?.name}</td>
                            <td>{money(c.amount_cents, c.currency)}</td>
                            <td>{c.status === "completed" ? <Badge value="paid" /> : abandoned ? "Abandoned" : "Open"}</td>
                            <td>Version {c.terms_version}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
