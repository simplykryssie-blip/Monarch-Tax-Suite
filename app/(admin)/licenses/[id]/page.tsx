import Link from "next/link";
import { notFound } from "next/navigation";
import { commerceRepo, requireAdmin } from "@/lib/admin";
import { authorizeDomainAction, removeDomainAction, setLicenseStatusAction } from "../../actions";
import { IssueKeyForm } from "@/components/admin/issue-key";
import { Badge, EmptyRow, Flash, label, load, money, PageTitle, SetupRequired, when } from "@/components/admin/ui";

export default async function LicensePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const repo = commerceRepo();
  const result = await load(async () => {
    const license = await repo.getLicense(id);
    if (!license) return null;
    const [customer, order, product, domains, events] = await Promise.all([
      repo.getCustomer(license.customer_id),
      repo.getOrder(license.order_id),
      repo.getProduct(license.product_id),
      repo.listDomains(license.id),
      repo.listLicenseEvents(license.id),
    ]);
    return { license, customer, order, product, domains, events };
  });
  if (!result.ok) return <SetupRequired message={result.message} />;
  if (!result.data) notFound();
  const { license, customer, order, product, domains, events } = result.data;
  const activeDomains = domains.filter((d) => d.status === "active");

  return (
    <>
      <PageTitle title={license.key_prefix ? `License ${license.key_prefix}…` : "License (key not issued)"} back={{ href: "/licenses", label: "Licenses" }}>
        {product?.name} · <Link href={`/customers/${license.customer_id}`}>{customer?.email}</Link> · <Badge value={license.status} />
      </PageTitle>
      <Flash {...await searchParams} />
      <div className="monarch-lower-grid">
        <section className="monarch-panel monarch-pad">
          <h2 className="monarch-h2">Access</h2>
          <dl className="monarch-dl">
            <dt>Status</dt><dd><Badge value={license.status} /></dd>
            <dt>Order</dt><dd>#{order?.order_number} · {order && money(order.amount_cents, order.currency)} · <Badge value={order?.payment_status ?? "pending"} /></dd>
            <dt>Key</dt><dd>{license.key_prefix ? `${license.key_prefix}… (only a hash is stored)` : "Not issued"}</dd>
            <dt>Embed ID (public)</dt><dd>{license.embed_id ? <code>{license.embed_id}</code> : "Assigned when the key is issued"}</dd>
            <dt>Issued</dt><dd>{when(license.issued_at)}</dd>
            <dt>First activation</dt><dd>{when(license.activated_at)}</dd>
            <dt>Domains allowed</dt><dd>{license.max_domains}</dd>
            {license.revoked_at && (<><dt>Revoked</dt><dd>{when(license.revoked_at)} — {license.revoke_reason}</dd></>)}
          </dl>
          {license.status !== "revoked" && <IssueKeyForm licenseId={license.id} rotating={Boolean(license.key_hash)} />}
          {license.status !== "revoked" && (
            <div className="monarch-inline-actions">
              {license.status === "suspended" && (
                <form action={setLicenseStatusAction}><input type="hidden" name="id" value={license.id} /><input type="hidden" name="status" value="active" /><button className="monarch-secondary">Reactivate</button></form>
              )}
              {license.status === "active" && (
                <form action={setLicenseStatusAction}><input type="hidden" name="id" value={license.id} /><input type="hidden" name="status" value="suspended" /><button className="monarch-secondary">Suspend</button></form>
              )}
              <form action={setLicenseStatusAction} className="monarch-revoke">
                <input type="hidden" name="id" value={license.id} />
                <input type="hidden" name="status" value="revoked" />
                <input name="reason" required maxLength={500} placeholder="Reason for revoking" />
                <button className="monarch-secondary is-danger">Revoke</button>
              </form>
            </div>
          )}
        </section>
        <section className="monarch-panel">
          <div className="monarch-panel-head"><h2>Authorized domains</h2><span>{activeDomains.length} / {license.max_domains}</span></div>
          <div className="monarch-table-wrap">
            <table>
              <thead><tr><th>DOMAIN</th><th>STATUS</th><th></th></tr></thead>
              <tbody>
                {domains.length === 0 ? <EmptyRow colSpan={3}>No domains authorized.</EmptyRow> : domains.map((d) => (
                  <tr key={d.id}>
                    <td><b>{d.domain}</b></td>
                    <td><Badge value={d.status} /></td>
                    <td>{d.status === "active" && (
                      <form action={removeDomainAction}><input type="hidden" name="id" value={license.id} /><input type="hidden" name="domain" value={d.domain} /><button className="monarch-link">Remove</button></form>
                    )}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {license.status === "active" && (
            <form action={authorizeDomainAction} className="monarch-inline-form">
              <input type="hidden" name="id" value={license.id} />
              <input name="domain" required maxLength={253} placeholder="client-site.com" />
              <button className="monarch-secondary">Authorize domain</button>
            </form>
          )}
        </section>
      </div>
      <section className="monarch-panel">
        <div className="monarch-panel-head"><h2>License history</h2></div>
        <div className="monarch-table-wrap">
          <table>
            <thead><tr><th>WHEN</th><th>EVENT</th><th>DETAIL</th></tr></thead>
            <tbody>
              {events.length === 0 ? <EmptyRow colSpan={3}>No events.</EmptyRow> : events.map((e) => (
                <tr key={e.id}><td>{when(e.created_at)}</td><td>{label(e.event_type)}</td><td>{Object.entries(e.detail).map(([k, v]) => `${label(k)}: ${String(v)}`).join(" · ")}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
