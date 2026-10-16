import { requireAdmin } from "@/lib/admin";
import { automationDeps } from "@/lib/automation/server";
import { SubmitOnce } from "@/components/admin/submit-once";
import { defaultLinkHost } from "@/lib/brands.ts";
import { senderAddress } from "@/lib/automation/senders.ts";
import { Badge, Flash, load, PageTitle, SetupRequired, when } from "@/components/admin/ui";
import { addSenderAction, archiveSenderAction, checkDomainAction, connectDomainAction, defaultSenderAction, removeDomainAction, saveBrandAction } from "../actions";

export default async function EmailSendingPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireAdmin();
  const { notice, error } = await searchParams;
  const deps = automationDeps();
  const result = await load(async () => ({ domains: await deps.senders!.listDomains(), senders: (await deps.senders!.listSenders()).filter((s) => !s.archived_at) }));
  const fallback = deps.fallbackSender;
  return (
    <>
      <PageTitle title="Email sending">Send client emails from your own domains. Add each domain you send from, then the addresses (brands) on it. Every email template and document step can choose which address it sends from.</PageTitle>
      <Flash notice={notice} error={error} />
      {!result.ok ? <SetupRequired message={result.message} /> : (
        <>
          <section className="monarch-panel">
            <div className="monarch-panel-head"><div><h2>Sending addresses</h2><p className="monarch-muted">{fallback ? `Until you add one, emails go from ${fallback.label}.` : "Add a verified address before workflows can email clients."}</p></div></div>
            <div className="monarch-table-wrap"><table>
              <thead><tr><th>FROM</th><th>REPLIES GO TO</th><th>DOMAIN</th><th></th></tr></thead>
              <tbody>
                {result.data.senders.length === 0 ? <tr><td colSpan={4} className="monarch-empty">No sending addresses yet.</td></tr> : result.data.senders.map((s) => {
                  const d = result.data.domains.find((x) => x.id === s.domain_id);
                  return (
                    <tr key={s.id}>
                      <td><b>{s.from_name}</b> &lt;{d ? senderAddress(s, d) : s.local_part}&gt;{s.is_default && <> <Badge value="default" /></>}</td>
                      <td>{s.reply_to ?? "the same address"}</td>
                      <td>{d?.domain} {d && <Badge value={d.status} />}</td>
                      <td style={{ display: "flex", gap: 8 }}>
                        {!s.is_default && <form action={defaultSenderAction}><input type="hidden" name="id" value={s.id} /><button className="monarch-secondary">Make default</button></form>}
                        <form action={archiveSenderAction}><input type="hidden" name="id" value={s.id} /><button className="monarch-secondary is-danger">Remove</button></form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
            {result.data.domains.length > 0 && (
              <form action={addSenderAction} className="monarch-form" style={{ padding: 20 }}>
                <label>Name people see<input name="from_name" required maxLength={80} placeholder="Your firm or brand name" /></label>
                <label>Address
                  <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input name="local_part" required maxLength={64} placeholder="support" style={{ maxWidth: 160 }} />@
                    <select name="domain_id" required>{result.data.domains.map((d) => <option key={d.id} value={d.id}>{d.domain}</option>)}</select>
                  </span>
                </label>
                <label>Replies go to (optional)<input name="reply_to" type="email" maxLength={254} /></label>
                <div className="is-wide"><button className="monarch-primary">Add sending address</button></div>
              </form>
            )}
          </section>

          <section className="monarch-panel">
            <div className="monarch-panel-head"><div><h2>Domains and brands</h2><p className="monarch-muted">A domain must be verified (its DNS records added) before anything is sent from it. Each domain is one of your firms or brands. Its form links use the web address shown (set for you as forms.&lt;your domain&gt;; change it only if you prefer another). With more than one brand, each form chooses the brand it belongs to.</p></div></div>
            {result.data.domains.map((d) => (
              <div key={d.id} style={{ padding: "12px 20px", borderTop: "1px solid #eee" }}>
                <p><b>{d.domain}</b> <Badge value={d.status} /> {d.last_checked_at && <small className="monarch-muted">checked {when(d.last_checked_at)}</small>}</p>
                {d.status !== "verified" && d.dns_records.length > 0 && (
                  <div className="monarch-table-wrap"><table>
                    <thead><tr><th>TYPE</th><th>NAME</th><th>VALUE</th><th>PRIORITY</th><th>STATUS</th></tr></thead>
                    <tbody>{d.dns_records.map((r, i) => <tr key={i}><td>{r.type}</td><td><code>{r.name}</code></td><td style={{ wordBreak: "break-all" }}><code>{r.value}</code></td><td>{r.priority ?? ""}</td><td>{r.status ?? ""}</td></tr>)}</tbody>
                  </table></div>
                )}
                <form action={saveBrandAction} className="monarch-inline-form" style={{ flexWrap: "wrap", margin: "8px 0" }}>
                  <input type="hidden" name="id" value={d.id} />
                  <input name="brand_name" defaultValue={d.brand_name ?? ""} placeholder="Brand name, e.g. Monarch Tax Suite" maxLength={120} aria-label="Brand name" />
                  <input name="link_host" defaultValue={d.link_host ?? defaultLinkHost(d.domain)} placeholder="Web address for form links" maxLength={253} aria-label="Web address for form links" />
                  <button className="monarch-secondary">Save brand</button>
                </form>
                <p className="monarch-muted" style={{ margin: "4px 0" }}>Form links: <code>https://{d.link_host ?? defaultLinkHost(d.domain)}/f/…</code>. At your domain host, add a CNAME record named <code>{(d.link_host ?? defaultLinkHost(d.domain)).split(".")[0]}</code> pointing to <code>cname.vercel-dns.com</code>; the same address must also be added to the app&apos;s hosting (Vercel → Domains).</p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <form action={checkDomainAction}><input type="hidden" name="id" value={d.id} /><button className="monarch-secondary">{d.status === "verified" ? "Check again" : "Check verification"}</button></form>
                  <form action={removeDomainAction}><input type="hidden" name="id" value={d.id} /><SubmitOnce className="monarch-secondary is-danger" busy="Disconnecting…">Disconnect domain</SubmitOnce></form>
                </div>
                <small className="monarch-muted">Disconnecting only removes it from this app (so you can add it again, for example after changing the Resend key). Nothing is deleted in Resend.</small>
              </div>
            ))}
            <form action={connectDomainAction} className="monarch-inline-form" style={{ padding: 20 }}>
              <input name="domain" required placeholder="yourfirm.com  or  mail.yourfirm.com" maxLength={253} aria-label="Domain" />
              <button className="monarch-primary">Add domain</button>
              <small className="monarch-muted" style={{ flexBasis: "100%" }}>Use your main domain (<code>yourfirm.com</code>, so emails come from you@yourfirm.com) or a subdomain (<code>mail.yourfirm.com</code>), whichever you prefer. A subdomain keeps these emails separate from your regular mailbox DNS; the main domain looks the most professional. Both work.</small>
            </form>
          </section>
        </>
      )}
    </>
  );
}
