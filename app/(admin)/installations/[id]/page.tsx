import Link from "next/link";
import { notFound } from "next/navigation";
import { appOrigin, commerceRepo, requireAdmin } from "@/lib/admin";
import { IntakeLinkButton } from "@/components/admin/intake-link";
import { embedSnippet, embedUrl, METHOD_LABELS, PLATFORM_GUIDES, PLATFORM_ORDER, SUPPORT_LABELS } from "@/lib/commerce/platforms.ts";
import { updateInstallationAction } from "../../actions";
import { Badge, EmptyRow, Flash, label, load, money, PageTitle, SetupRequired, when } from "@/components/admin/ui";

export default async function InstallationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const repo = commerceRepo();
  const result = await load(async () => {
    const installation = await repo.getInstallation(id);
    if (!installation) return null;
    const [customer, order, product, license, events, domains] = await Promise.all([
      repo.getCustomer(installation.customer_id),
      repo.getOrder(installation.order_id),
      repo.getProduct(installation.product_id),
      installation.license_id ? repo.getLicense(installation.license_id) : Promise.resolve(null),
      repo.listInstallationEvents(installation.id),
      installation.license_id ? repo.listDomains(installation.license_id) : Promise.resolve([]),
    ]);
    return { installation, customer, order, product, license, events, domains };
  });
  if (!result.ok) return <SetupRequired message={result.message} />;
  if (!result.data) notFound();
  const { installation: i, customer, order, product, license, events, domains } = result.data;
  const guide = PLATFORM_GUIDES[i.platform];
  const activeDomains = domains.filter((d) => d.status === "active").map((d) => d.domain);
  const origin = await appOrigin();
  const canEmbed = license?.status === "active" && license.embed_id && activeDomains.length > 0;

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
            <dt>Platform</dt><dd>{guide.label}{i.platform === "other" && i.platform_other ? ` — ${i.platform_other}` : ""}</dd>
            <dt>Method</dt><dd>{METHOD_LABELS[i.installation_method]}</dd>
            <dt>Website URL</dt><dd>{i.website_url ? <a href={i.website_url} target="_blank" rel="noreferrer">{i.website_url}</a> : "Not provided"}</dd>
            <dt>Domain</dt><dd>{i.target_location ?? "Not provided"}</dd>
            <dt>Authorized domains</dt><dd>{activeDomains.length ? activeDomains.join(", ") : "None yet"}</dd>
            <dt>Customer details</dt><dd>{i.intake_submitted_at ? `Submitted ${when(i.intake_submitted_at)}` : i.intake_expires_at ? `Link sent, expires ${when(i.intake_expires_at)}` : "Not requested"}</dd>
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
            <label>Platform
              <select name="platform" required defaultValue={i.platform}>
                {PLATFORM_ORDER.map((p) => <option key={p} value={p}>{PLATFORM_GUIDES[p].label}</option>)}
              </select>
            </label>
            <label>Platform name (if Other)<input name="platform_other" maxLength={80} defaultValue={i.platform_other ?? ""} /></label>
            <label>Installation method
              <select name="installation_method" required defaultValue={i.installation_method}>
                {Object.entries(METHOD_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label>Website or funnel URL<input name="website_url" maxLength={500} defaultValue={i.website_url ?? ""} placeholder="https://…" /></label>
            <label>Domain where it will run<input name="target_location" maxLength={253} defaultValue={i.target_location ?? ""} placeholder="example.com" /></label>
            <label className="is-wide">Technical instructions / requirements<textarea name="requirements" rows={3} maxLength={4000} defaultValue={i.requirements ?? ""} /></label>
            <label className="is-wide">Internal notes<textarea name="internal_notes" rows={4} maxLength={4000} defaultValue={i.internal_notes ?? ""} /></label>
            <label className="is-wide">Add to history (optional)<input name="note" maxLength={1000} placeholder="e.g. Received GHL sub-account access" /></label>
            <div className="is-wide"><button className="monarch-primary" type="submit">Save</button></div>
          </form>
        </section>
      </div>
      <section className="monarch-panel monarch-pad monarch-snippet">
        <h2 className="monarch-h2">Installation guide — {guide.label} <span className={"monarch-badge " + guide.support.replace(/_/g, "-")}>{SUPPORT_LABELS[guide.support]}</span></h2>
        <p className="monarch-muted">{guide.supportNote}</p>
        <ol>{guide.steps.map((step) => <li key={step}>{step}</li>)}</ol>
        {guide.limitations.length > 0 && <ul className="monarch-muted">{guide.limitations.map((l) => <li key={l}>{l}</li>)}</ul>}
        {canEmbed ? (
          <>
            <label>Embed code (contains only the public embed ID, never the license key)<textarea readOnly rows={3} value={embedSnippet(origin, license!.embed_id!)} /></label>
            <label>Calculator URL (for platforms that only accept a URL)<input readOnly value={embedUrl(origin, license!.embed_id!)} /></label>
          </>
        ) : (
          <p className="monarch-alert">Embed code appears here once the license is active (key issued) and at least one domain is authorized on the license.</p>
        )}
        <IntakeLinkButton installationId={i.id} submittedAt={i.intake_submitted_at} />
      </section>
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
