import Link from "next/link";
import { notFound } from "next/navigation";
import { commerceRepo, requireAdmin, serviceOrdersRepo } from "@/lib/admin";
import { SERVICE_STATUS_LABELS, SERVICE_STATUSES, serviceNextStep } from "@/lib/commerce/service-orders.ts";
import { updateServiceOrderAction } from "../../service-actions";
import { Badge, EmptyRow, Flash, load, money, PageTitle, SetupRequired, when } from "@/components/admin/ui";

export default async function ServiceOrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const result = await load(async () => {
    const so = await serviceOrdersRepo().getServiceOrder(id);
    if (!so) return null;
    const [events, order, customer, product] = await Promise.all([serviceOrdersRepo().listServiceOrderEvents(so.id), commerceRepo().getOrder(so.order_id), commerceRepo().getCustomer(so.customer_id), commerceRepo().getProduct(so.product_id)]);
    return { so, events, order, customer, product };
  });
  if (!result.ok) return <SetupRequired message={result.message} />;
  if (!result.data) notFound();
  const { so, events, order, customer, product } = result.data;
  const next = serviceNextStep(so);
  const closed = so.status === "canceled";
  return (
    <>
      <PageTitle title={`Service order #${order?.order_number ?? ""}`} back={{ href: "/service-orders", label: "Service orders" }}>
        {product?.name} · <Link href={`/customers/${so.customer_id}`}>{customer?.full_name ?? customer?.email}</Link> · {SERVICE_STATUS_LABELS[so.status]}
      </PageTitle>
      <Flash {...await searchParams} />
      <section className="monarch-panel monarch-pad">
        <h2 className="monarch-h2">Next step</h2>
        <p><b>{{ nobody: "Nothing to do", owner: "Waiting on the owner", customer: "Waiting on the customer" }[next.waitingOn]}:</b> {next.text}</p>
      </section>
      <div className="monarch-lower-grid">
        <section className="monarch-panel monarch-pad">
          <h2 className="monarch-h2">What was promised</h2>
          <p className="monarch-muted">Copied from the product when the order was paid. Later product edits do not change it.</p>
          <dl className="monarch-dl">
            <dt>Deliverable</dt><dd>{so.deliverable}</dd>
            <dt>Owner</dt><dd>{so.owner}</dd>
            <dt>Response time</dt><dd>{so.response_time}</dd>
            <dt>Order</dt><dd>#{order?.order_number} · {order && money(order.amount_cents, order.currency)} · <Badge value={order?.payment_status ?? "pending"} /></dd>
            <dt>Customer</dt><dd>{customer?.full_name ?? "—"} · {customer?.email}</dd>
            <dt>Opened</dt><dd>{when(so.created_at)}</dd>
            {so.delivered_at && (<><dt>Delivered</dt><dd>{when(so.delivered_at)}</dd></>)}
            {so.canceled_at && (<><dt>Canceled</dt><dd>{when(so.canceled_at)}</dd></>)}
          </dl>
        </section>
        <section className="monarch-panel monarch-pad">
          <h2 className="monarch-h2">Update</h2>
          {closed ? (
            <p className="monarch-muted">This service order is canceled. Nothing more can change.</p>
          ) : (
            <form action={updateServiceOrderAction} className="monarch-form">
              <input type="hidden" name="id" value={so.id} />
              <label>Status
                <select name="status" defaultValue={so.status}>
                  {SERVICE_STATUSES.map((s) => <option key={s} value={s}>{SERVICE_STATUS_LABELS[s]}</option>)}
                </select>
              </label>
              <label className="is-wide">Next step (what happens next, and who does it)<input name="next_step" defaultValue={so.next_step ?? ""} maxLength={500} /></label>
              <label className="is-wide">Note (kept in the history)<textarea name="note" rows={3} maxLength={2000} /></label>
              <div className="is-wide"><button className="monarch-primary" type="submit">Save</button> <small className="monarch-muted">Marking it Delivered emails the customer a completion notice.</small></div>
            </form>
          )}
        </section>
      </div>
      <section className="monarch-panel">
        <div className="monarch-panel-head"><div><h2>History</h2></div></div>
        <div className="monarch-table-wrap">
          <table>
            <thead><tr><th>WHEN</th><th>CHANGE</th><th>NOTE</th></tr></thead>
            <tbody>
              {events.length === 0 ? <EmptyRow colSpan={3}>No history yet.</EmptyRow> : events.map((e) => (
                <tr key={e.id}>
                  <td>{when(e.created_at)}</td>
                  <td>{e.to_status ? `${e.from_status ? SERVICE_STATUS_LABELS[e.from_status] : "—"} → ${SERVICE_STATUS_LABELS[e.to_status]}` : "—"}</td>
                  <td>{e.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
