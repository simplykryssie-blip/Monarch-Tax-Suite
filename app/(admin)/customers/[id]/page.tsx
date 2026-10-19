import Link from "next/link";
import { notFound } from "next/navigation";
import { commerceRepo, requireAdmin } from "@/lib/admin";
import { Badge, EmptyRow, Flash, label, load, money, PageTitle, SetupRequired, when } from "@/components/admin/ui";
import { ArchivePanel } from "@/components/admin/archive";
import { wispDeps } from "@/lib/wisp/server";
import { currentTenantId } from "@/lib/tenants";
import { adminResendWispAction } from "../../store/wisp/actions";
import { PLATFORM_GUIDES } from "@/lib/commerce/platforms.ts";
import { formDeps } from "@/lib/forms/server";

export default async function CustomerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const { notice, error } = await searchParams;
  const repo = commerceRepo();
  const result = await load(async () => {
    const customer = await repo.getCustomer(id);
    if (!customer) return null;
    const [orders, licenses, installations, products] = await Promise.all([repo.listOrders(), repo.listLicenses(), repo.listInstallations(), repo.listProducts()]);
    return {
      customer,
      orders: orders.filter((o) => o.customer_id === id),
      licenses: licenses.filter((l) => l.customer_id === id),
      installations: installations.filter((i) => i.customer_id === id),
      products: new Map(products.map((p) => [p.id, p])),
    };
  });
  if (!result.ok) return <SetupRequired message={result.message} />;
  if (!result.data) notFound();
  const { customer, orders, licenses, installations, products } = result.data;
  // Form submissions filed on this customer, each with its PDF (empty if the Form Builder is not installed).
  const submissions = await (async () => {
    try {
      const deps = formDeps();
      const subs = await deps.repo.listSubmissionsForCustomer(customer.id);
      const forms = new Map((await deps.repo.listForms()).map((f) => [f.id, f]));
      return subs.map((s) => ({ s, form: forms.get(s.form_id) }));
    } catch {
      return [];
    }
  })();

  // WISPs this customer bought (empty if the WISP Generator is not installed).
  const wisps = await wispDeps(currentTenantId()).repo.listPlans({ customerId: customer.id, limit: 50 }).catch(() => []);

  return (
    <>
      <PageTitle title={customer.full_name ?? customer.email} back={{ href: "/customers", label: "Customers" }}>
        {customer.email} · <Badge value={customer.status} />{customer.archived_at && <> · <Badge value="archived" /></>} · Customer since {when(customer.created_at)}
      </PageTitle>
      <Flash notice={notice} error={error} />
      <section className="monarch-panel">
        <div className="monarch-panel-head"><h2>Purchases</h2></div>
        <div className="monarch-table-wrap">
          <table>
            <thead><tr><th>ORDER</th><th>TYPE</th><th>PRODUCT</th><th>AMOUNT</th><th>PAYMENT</th><th>INSTALLATION</th><th>VERIFIED BY</th><th>STRIPE REFERENCE</th><th>DATE</th></tr></thead>
            <tbody>
              {orders.length === 0 ? <EmptyRow colSpan={9}>No purchases.</EmptyRow> : orders.map((o) => (
                <tr key={o.id}>
                  <td>#{o.order_number}</td>
                  <td>{o.order_type === "annual_update" ? `Annual update → ${o.tax_year}` : "Purchase"}</td>
                  <td>{products.get(o.product_id)?.name}</td>
                  <td><b>{money(o.amount_cents, o.currency)}</b>{o.amount_refunded_cents > 0 && <small className="monarch-subcell">Refunded {money(o.amount_refunded_cents, o.currency)}</small>}</td>
                  <td><Badge value={o.payment_status} /></td>
                  <td>{label(o.installation_type)}</td>
                  <td>{label(o.verification_method)}</td>
                  <td><code>{o.provider_payment_intent_id ?? "—"}</code></td>
                  <td>{when(o.paid_at ?? o.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="monarch-lower-grid">
        <section className="monarch-panel">
          <div className="monarch-panel-head"><h2>Licenses</h2></div>
          <div className="monarch-table-wrap">
            <table>
              <thead><tr><th>LICENSE</th><th>PRODUCT</th><th>VERSION</th><th>STATUS</th></tr></thead>
              <tbody>
                {licenses.length === 0 ? <EmptyRow colSpan={4}>No licenses.</EmptyRow> : licenses.map((l) => (
                  <tr key={l.id}>
                    <td><Link href={`/licenses/${l.id}`}><b>{l.key_prefix ? `${l.key_prefix}…` : "Key not issued"}</b></Link></td>
                    <td>{products.get(l.product_id)?.name}</td>
                    <td>{l.licensed_tax_year ?? "—"}{l.original_tax_year && l.original_tax_year !== l.licensed_tax_year ? ` (originally ${l.original_tax_year})` : ""}{(() => { const last = orders.filter((o) => o.order_type === "annual_update" && o.license_id === l.id && o.payment_status === "paid").sort((a, b) => (b.paid_at ?? "").localeCompare(a.paid_at ?? ""))[0]; return last ? <small className="monarch-subcell">Last update {when(last.paid_at)}</small> : null; })()}</td>
                    <td><Badge value={l.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="monarch-panel">
          <div className="monarch-panel-head"><h2>Installations</h2></div>
          <div className="monarch-table-wrap">
            <table>
              <thead><tr><th>TYPE</th><th>PLATFORM</th><th>STATUS</th></tr></thead>
              <tbody>
                {installations.length === 0 ? <EmptyRow colSpan={3}>No installations.</EmptyRow> : installations.map((i) => (
                  <tr key={i.id}>
                    <td><Link href={`/installations/${i.id}`}><b>{label(i.installation_type)}</b></Link></td>
                    <td>{PLATFORM_GUIDES[i.platform].label}</td>
                    <td><Badge value={i.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      <section className="monarch-panel">
        <div className="monarch-panel-head"><h2>Form submissions</h2></div>
        <div className="monarch-table-wrap">
          <table>
            <thead><tr><th>FORM</th><th>#</th><th>SUBMITTED</th><th>STATUS</th><th>PDF</th></tr></thead>
            <tbody>
              {submissions.length === 0 ? <EmptyRow colSpan={5}>No form submissions.</EmptyRow> : submissions.map(({ s, form }) => (
                <tr key={s.id}>
                  <td><Link href={`/forms/${s.form_id}/submissions/${s.id}`}><b>{form?.name ?? "Form"}</b></Link></td>
                  <td>#{s.number}</td>
                  <td>{when(s.submitted_at)}</td>
                  <td><Badge value={s.status} /></td>
                  <td>{s.pdf_path ? <a href={`/forms/pdf/${s.id}`}>Download PDF</a> : "Being made"}<small className="monarch-subcell">{s.pdf_sha256 ? `SHA-256 ${s.pdf_sha256.slice(0, 16)}…` : ""}</small></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="monarch-notice"><b>SUPPORT HISTORY</b> No support system is connected yet, so there is no support history to show.</div>
      {wisps.length > 0 && (
        <section className="monarch-panel">
          <div className="monarch-panel-head"><h2>WISPs</h2><span>{wisps.length}</span></div>
          <div className="monarch-table-wrap"><table>
            <thead><tr><th>FIRM</th><th>BOUGHT</th><th>EMAIL</th><th /></tr></thead>
            <tbody>{wisps.map((p) => (
              <tr key={p.id}>
                <td><b>{p.firm_name}</b></td>
                <td>{when(p.created_at)}</td>
                <td>{p.emailed_at ? `Sent to ${p.email}` : p.email_error ? `Not sent: ${p.email_error.slice(0, 80)}` : p.email}</td>
                <td style={{ display: "flex", gap: 8 }}>
                  {p.pdf_path && <a className="monarch-secondary" href={`/store/wisp/download/${p.id}`}>Download</a>}
                  {p.status !== "draft" && <form action={adminResendWispAction}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="back" value={`/customers/${customer.id}`} /><button className="monarch-secondary">Email again</button></form>}
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        </section>
      )}
      <ArchivePanel entity="customer" id={customer.id} />
    </>
  );
}
