import Link from "next/link";
import { notFound } from "next/navigation";
import { commerceRepo, requireAdmin } from "@/lib/admin";
import { updateInstallationAction } from "../../actions";
import { Badge, EmptyRow, Flash, label, load, money, PageTitle, SetupRequired, when } from "@/components/admin/ui";

export default async function InstallationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const repo = commerceRepo();
  const result = await load(async () => {
    const installation = await repo.getInstallation(id);
    if (!installation) return null;
    const [customer, order, product, license, events] = await Promise.all([
      repo.getCustomer(installation.customer_id),
      repo.getOrder(installation.order_id),
      repo.getProduct(installation.product_id),
      installation.license_id ? repo.getLicense(installation.license_id) : Promise.resolve(null),
      repo.listInstallationEvents(installation.id),
    ]);
    return { installation, customer, order, product, license, events };
  });
  if (!result.ok) return <SetupRequired message={result.message} />;
  if (!result.data) notFound();
  const { installation: i, customer, order, product, license, events } = result.data;

  return (
    <>
      <PageTitle title={`${label(i.installation_type)} installation`} back={{ href: "/installations", label: "Installations" }}>
        {product?.name} · <Link href={`/customers/${i.customer_id}`}>{customer?.full_name ?? customer?.email}</Link> · <Badge value={i.status} />
      </PageTitle>
      <Flash {...await searchParams} />
      <div className="monarch-lower-grid">
        <section className="monarch-panel monarch-pad">
          <h2 className="monarch-h2">Order &amp; payment</h2>
          <dl className="monarch-dl">
            <dt>Customer</dt><dd>{customer?.full_name ?? "—"} · {customer?.email}</dd>
            <dt>Order</dt><dd>#{order?.order_number} · {order && money(order.amount_cents, order.currency)}</dd>
            <dt>Payment</dt><dd><Badge value={order?.payment_status ?? "pending"} /></dd>
            <dt>Verified by</dt><dd>{label(order?.verification_method)} · {when(order?.verified_at ?? null)}</dd>
            <dt>Stripe reference</dt><dd><code>{order?.provider_payment_intent_id ?? "—"}</code></dd>
            <dt>License</dt><dd>{license ? <Link href={`/licenses/${license.id}`}><Badge value={license.status} /> {license.key_prefix ? `${license.key_prefix}…` : "key not issued"}</Link> : "—"}</dd>
            <dt>Created</dt><dd>{when(i.created_at)}</dd>
            <dt>Updated</dt><dd>{when(i.updated_at)}</dd>
          </dl>
        </section>
        <section className="monarch-panel monarch-pad">
          <h2 className="monarch-h2">Update installation</h2>
          <form action={updateInstallationAction} className="monarch-form">
            <input type="hidden" name="id" value={i.id} />
            <label>Status
              <select name="status" defaultValue={i.status}>
                <option value="requested">Requested</option>
                <option value="in_progress">In Progress</option>
                <option value="blocked">Blocked</option>
                <option value="active">Active</option>
                <option value="removed">Removed</option>
              </select>
            </label>
            <label>Installation type
              <select name="installation_type" defaultValue={i.installation_type}>
                <option value="done_for_you">Done For You</option>
                <option value="self_service">Self-service</option>
              </select>
            </label>
            <label>Target platform
              <select name="platform" required defaultValue={i.platform}>
                <option value="gohighlevel">GoHighLevel</option>
                <option value="website">Website</option>
                <option value="jotform">Jotform</option>
                <option value="other">Other (not confirmed yet)</option>
              </select>
            </label>
            <label>Installation domain or location<input name="target_location" maxLength={500} defaultValue={i.target_location ?? ""} /></label>
            <label className="is-wide">Internal notes<textarea name="internal_notes" rows={4} maxLength={4000} defaultValue={i.internal_notes ?? ""} /></label>
            <label className="is-wide">Add to history (optional)<input name="note" maxLength={1000} placeholder="e.g. Received GHL sub-account access" /></label>
            <div className="is-wide"><button className="monarch-primary" type="submit">Save</button></div>
          </form>
        </section>
      </div>
      <section className="monarch-panel">
        <div className="monarch-panel-head"><h2>History</h2></div>
        <div className="monarch-table-wrap">
          <table>
            <thead><tr><th>WHEN</th><th>STATUS CHANGE</th><th>NOTE</th></tr></thead>
            <tbody>
              {events.length === 0 ? <EmptyRow colSpan={3}>No history yet.</EmptyRow> : events.map((e) => (
                <tr key={e.id}>
                  <td>{when(e.created_at)}</td>
                  <td>{e.to_status ? `${e.from_status ? label(e.from_status) + " → " : ""}${label(e.to_status)}` : "—"}</td>
                  <td className="monarch-wrap">{e.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
