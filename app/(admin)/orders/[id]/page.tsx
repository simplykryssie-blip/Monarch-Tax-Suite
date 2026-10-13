import Link from "next/link";
import { notFound } from "next/navigation";
import { commerceRepo, requireAdmin } from "@/lib/admin";
import { isInternalOrder, needsReview } from "@/lib/commerce/fulfillment.ts";
import { Badge, Flash, label, load, money, PageTitle, SetupRequired, when } from "@/components/admin/ui";
import { ArchivePanel } from "@/components/admin/archive";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default async function OrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const { notice, error } = await searchParams;
  if (!UUID.test(id)) notFound();
  const repo = commerceRepo();
  const result = await load(async () => {
    const order = await repo.getOrder(id);
    if (!order) return null;
    const [customer, product, licenses] = await Promise.all([repo.getCustomer(order.customer_id), repo.getProduct(order.product_id), repo.listLicenses()]);
    return { order, customer, product, licenses: licenses.filter((l) => l.order_id === order.id || l.id === order.license_id) };
  });
  if (!result.ok) return <SetupRequired message={result.message} />;
  if (!result.data) notFound();
  const { order: o, customer: c, product, licenses } = result.data;
  return (
    <>
      <PageTitle title={`Order #${o.order_number}`} back={{ href: "/orders", label: "Orders" }}>
        <Badge value={o.payment_status} />{o.archived_at && <> · <Badge value="archived" /></>} · {when(o.paid_at ?? o.created_at)}
      </PageTitle>
      <Flash notice={notice} error={error} />
      <section className="monarch-panel" style={{ padding: 20 }}>
        <dl className="monarch-facts" style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "6px 16px", margin: 0 }}>
          <dt>Customer</dt><dd>{c ? <Link href={`/customers/${c.id}`}>{c.full_name ?? c.email}</Link> : "—"}{c && <small className="monarch-subcell">{c.email}</small>}</dd>
          <dt>Product</dt><dd>{product?.name ?? "—"}</dd>
          <dt>Type</dt><dd>{o.order_type === "annual_update" ? `Annual update → ${o.tax_year}` : "Purchase"}</dd>
          <dt>Amount</dt><dd><b>{money(o.amount_cents, o.currency)}</b>{o.amount_refunded_cents > 0 && ` (${money(o.amount_refunded_cents, o.currency)} refunded)`}{isInternalOrder(o) && " · internal, no payment"}</dd>
          <dt>Verified by</dt><dd>{label(o.verification_method)}{o.verified_at ? ` · ${when(o.verified_at)}` : ""}</dd>
          {o.installation_type && <><dt>Installation</dt><dd>{label(o.installation_type)}</dd></>}
          {licenses.length > 0 && <><dt>License</dt><dd>{licenses.map((l) => <Link key={l.id} href={`/licenses/${l.id}`} style={{ marginRight: 10 }}>{l.key_prefix} ({l.status})</Link>)}</dd></>}
          {needsReview(o) && <><dt>Needs review</dt><dd>{o.notes!.slice("Review:".length).trim()}</dd></>}
        </dl>
      </section>
      <ArchivePanel entity="order" id={o.id} />
    </>
  );
}
