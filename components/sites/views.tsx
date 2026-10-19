import Link from "next/link";
import { Flash } from "@/components/admin/ui";
import { SitePreview } from "@/components/sites/render";
import { PageForm, type PickBooking, type PickForm, type PickImage } from "@/components/sites/page-form";
import { appointmentDeps } from "@/lib/appointments/server";
import { dnsInstructions, platformDomain } from "@/lib/sites/domains.ts";
import { SupabaseFormsRepo } from "@/lib/forms/supabase-repo";
import { SupabaseImagesRepo } from "@/lib/images/supabase-repo";
import { viewFor } from "@/lib/sites/public";
import type { SitesContext } from "@/lib/sites/context";
import { hasUnpublishedChanges, MAX_CUSTOM_DOMAINS, MAX_PAGES } from "@/lib/sites/service.ts";
import { vercelProblems } from "@/lib/sites/vercel.ts";
import { tenantClient } from "@/lib/supabase/service";
import { addDomainAction, addPageAction, movePageAction, publishAction, refreshDomainAction, removeDomainAction, removePageAction, savePageAction, setSubdomainAction, unpublishAction } from "@/app/sites-actions";
import { uploadSiteImageAction } from "@/app/sites-image-actions";

type Search = { notice?: string; error?: string };

const Hidden = ({ ctx }: { ctx: SitesContext }) => <input type="hidden" name="area" value={ctx.area} />;
const STATUS: Record<string, string> = { active: "Connected", pending: "Waiting for DNS", error: "Needs attention" };

function Tabs({ ctx, here }: { ctx: SitesContext; here: "pages" | "domains" }) {
  return (
    <nav className="cl-tabs" aria-label="Website">
      <Link href={ctx.base} className={here === "pages" ? "is-on" : undefined} aria-current={here === "pages" ? "page" : undefined}>Pages</Link>
      <Link href={`${ctx.base}/domains`} className={here === "domains" ? "is-on" : undefined} aria-current={here === "domains" ? "page" : undefined}>Addresses</Link>
    </nav>
  );
}

export async function SitesOverview({ ctx, sp }: { ctx: SitesContext; sp: Search }) {
  const [pages, domains] = await Promise.all([ctx.deps.repo.listPages(ctx.site.id), ctx.deps.repo.listDomains(ctx.site.id)]);
  const sorted = pages.slice().sort((a, b) => a.position - b.position);
  const live = ctx.site.status === "published";
  const changed = hasUnpublishedChanges(pages);
  const sub = domains.find((d) => d.kind === "subdomain");
  const addresses = [sub, ...domains.filter((d) => d.kind === "custom" && d.status === "active")].filter(Boolean);
  return (
    <>
      <h1 className="office-h1">Website</h1>
      <Flash notice={sp.notice} error={sp.error} />
      <Tabs ctx={ctx} here="pages" />
      <section className="monarch-panel" style={{ padding: 20 }}>
        <div className="se-status">
          <b>{live ? "Live" : "Not published"}</b>
          {changed && <span className="monarch-muted">{live ? "You have changes that visitors can't see yet." : "Nothing is public yet."}</span>}
          <form action={publishAction}><Hidden ctx={ctx} /><button className="monarch-primary">{live ? "Publish changes" : "Publish site"}</button></form>
          {live && <form action={unpublishAction}><Hidden ctx={ctx} /><button className="monarch-secondary">Take offline</button></form>}
        </div>
        {live && addresses.length > 0 && <p style={{ marginBottom: 0 }}>Your site: {addresses.map((d, i) => <span key={d!.id}>{i > 0 && ", "}<a href={`https://${d!.hostname}`} target="_blank" rel="noreferrer">{d!.hostname}</a></span>)}</p>}
        {!live && sub && <p className="monarch-muted" style={{ marginBottom: 0 }}>Once published, your site is at <b>{sub.hostname}</b>.</p>}
      </section>
      <section className="monarch-panel">
        <div className="monarch-panel-head"><div><h2>Pages</h2><p>Start with a blank page and add sections and blocks. The menu follows this order.</p></div></div>
        <div className="monarch-table-wrap"><table>
          <thead><tr><th>PAGE</th><th>ADDRESS</th><th>MENU</th><th></th></tr></thead>
          <tbody>
            {sorted.map((p, i) => (
              <tr key={p.id}>
                <td><b>{p.title}</b>{p.published === null && <span className="monarch-muted"> · not published</span>}</td>
                <td>{p.is_home ? "/" : `/${p.slug}`}</td>
                <td>{p.show_in_nav ? "Shown" : "Hidden"}</td>
                <td style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Link className="monarch-secondary efin-small" href={`${ctx.base}/pages/${p.id}`}>Edit</Link>
                  {!p.is_home && i > 1 && <form action={movePageAction}><Hidden ctx={ctx} /><input type="hidden" name="page_id" value={p.id} /><input type="hidden" name="direction" value="up" /><button className="monarch-link" aria-label={`Move ${p.title} up in the menu`}>↑</button></form>}
                  {!p.is_home && i < sorted.length - 1 && <form action={movePageAction}><Hidden ctx={ctx} /><input type="hidden" name="page_id" value={p.id} /><input type="hidden" name="direction" value="down" /><button className="monarch-link" aria-label={`Move ${p.title} down in the menu`}>↓</button></form>}
                  {!p.is_home && <form action={removePageAction}><Hidden ctx={ctx} /><input type="hidden" name="page_id" value={p.id} /><button className="monarch-link is-danger">Remove</button></form>}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </section>
      {pages.length < MAX_PAGES && (
        <section className="monarch-panel" style={{ padding: 20 }}>
          <h2 style={{ marginTop: 0 }}>Add a page</h2>
          <form action={addPageAction} className="monarch-inline-form" style={{ flexWrap: "wrap" }}><Hidden ctx={ctx} /><input name="title" required maxLength={120} placeholder="For example, About us" aria-label="Page title" /><button className="monarch-primary">Add page</button></form>
        </section>
      )}
    </>
  );
}

async function pickers(ctx: SitesContext) {
  const db = tenantClient(ctx.tenantId);
  const [imgs, types, forms] = await Promise.all([
    new SupabaseImagesRepo(db).list(200).catch(() => []),
    appointmentDeps(ctx.tenantId).repo.listTypes().catch(() => []),
    new SupabaseFormsRepo(db).listForms().catch(() => []),
  ]);
  const images: PickImage[] = imgs.map((i) => ({ id: i.id, label: i.alt_text || i.file_name, url: `/media/${ctx.tenantId}/${i.storage_path}` }));
  const bookings: PickBooking[] = types.filter((t) => t.active).map((t) => ({ slug: t.slug, name: t.name }));
  const formList: PickForm[] = forms.filter((f) => f.status === "published" && !f.archived_at).map((f) => ({ id: f.public_id, name: f.name }));
  return { images, bookings, forms: formList };
}

export async function PageEditorView({ ctx, id, sp }: { ctx: SitesContext; id: string; sp: Search }) {
  const page = await ctx.deps.repo.getPage(id);
  if (!page || page.site_id !== ctx.site.id) return <><h1 className="office-h1">Page not found</h1><p><Link href={ctx.base}>Back to your website</Link></p></>;
  const [pick, pages] = await Promise.all([pickers(ctx), ctx.deps.repo.listPages(ctx.site.id)]);
  const view = await viewFor(ctx.tenantId, ctx.site.name, pages, page.draft);
  return (
    <>
      <Link className="monarch-back" href={ctx.base}>← Website</Link>
      <h1 className="office-h1">{page.title}</h1>
      <Flash notice={sp.notice} error={sp.error} />
      <section className="monarch-panel" style={{ padding: 20 }}>
        <PageForm
          action={savePageAction} area={ctx.area} pageId={page.id} title={page.title} description={page.description ?? ""} showInNav={page.show_in_nav} isHome={page.is_home}
          initial={page.draft} images={pick.images} bookings={pick.bookings} forms={pick.forms}
        />
      </section>
      <section className="monarch-panel" style={{ padding: 20 }}>
        <h2 style={{ marginTop: 0 }}>Upload a picture</h2>
        <form action={uploadSiteImageAction} className="monarch-inline-form" style={{ flexWrap: "wrap" }}>
          <Hidden ctx={ctx} /><input type="hidden" name="page_id" value={page.id} />
          <input type="file" name="file" required accept="image/png,image/jpeg,image/webp" aria-label="Picture (PNG, JPG or WebP, up to 4 MB)" />
          <input name="alt" maxLength={200} placeholder="Describe the picture" aria-label="Picture description" />
          <button className="monarch-primary">Upload</button>
        </form>
        <p className="monarch-muted">PNG, JPG or WebP, up to 4 MB. Save your draft first; uploading reloads the page. The picture then appears in each Image block&apos;s list.</p>
      </section>
      <section className="monarch-panel" style={{ padding: 20 }}>
        <h2 style={{ marginTop: 0 }}>Preview of the saved draft</h2>
        <div style={{ border: "1px solid #e7e5de", borderRadius: 8, overflow: "hidden" }}>
          <SitePreview view={view} blocks={page.draft} />
        </div>
        <p className="monarch-muted">This is the draft you last saved. Visitors only see it after you publish.</p>
      </section>
    </>
  );
}

export async function DomainsView({ ctx, sp }: { ctx: SitesContext; sp: Search }) {
  const domains = await ctx.deps.repo.listDomains(ctx.site.id);
  const sub = domains.find((d) => d.kind === "subdomain");
  const custom = domains.filter((d) => d.kind === "custom");
  const platform = platformDomain();
  const problems = vercelProblems(process.env);
  return (
    <>
      <h1 className="office-h1">Website addresses</h1>
      <Flash notice={sp.notice} error={sp.error} />
      <Tabs ctx={ctx} here="domains" />
      <section className="monarch-panel" style={{ padding: 20 }}>
        <h2 style={{ marginTop: 0 }}>Your free address</h2>
        <p>Every website gets an address on {platform} automatically. You can change the first part; the old address stops working right away.</p>
        <form action={setSubdomainAction} className="monarch-inline-form" style={{ flexWrap: "wrap", alignItems: "center" }}>
          <Hidden ctx={ctx} />
          <input name="label" required defaultValue={ctx.site.slug} maxLength={40} aria-label="Address" style={{ maxWidth: 220 }} /> <span>.{platform}</span>
          <button className="monarch-secondary">Change</button>
        </form>
        {sub && <p className="monarch-muted" style={{ marginBottom: 0 }}>Currently <b>{sub.hostname}</b>.</p>}
      </section>
      <section className="monarch-panel" style={{ padding: 20 }}>
        <h2 style={{ marginTop: 0 }}>Your own domain</h2>
        <p>Connect a domain you own, such as <b>www.yourfirm.com</b>. You&apos;ll add one or two records at the company where you bought it. Your free address keeps working.</p>
        {problems.length > 0 && <p className="monarch-notice" role="note"><b>NOT TURNED ON</b> Connecting your own domain isn&apos;t set up on this deployment yet: {problems.join(" ")}</p>}
        {custom.length < MAX_CUSTOM_DOMAINS && (
          <form action={addDomainAction} className="monarch-inline-form" style={{ flexWrap: "wrap" }}><Hidden ctx={ctx} /><input name="host" required maxLength={253} placeholder="www.yourfirm.com" aria-label="Your domain" /><button className="monarch-primary" disabled={problems.length > 0}>Connect domain</button></form>
        )}
        {custom.map((d) => (
          <div key={d.id} style={{ marginTop: 18, borderTop: "1px solid #e7e5de", paddingTop: 14 }}>
            <div className="se-status"><b>{d.hostname}</b><span>{STATUS[d.status]}</span></div>
            {d.status !== "active" && (
              <>
                <p>Add {dnsInstructions(d.hostname, d.detail.verification).length === 1 ? "this record" : "these records"} at your domain provider, then press <b>Check now</b>. Changes can take a few minutes to a day.</p>
                <div className="monarch-table-wrap"><table className="se-dns">
                  <thead><tr><th>TYPE</th><th>NAME</th><th>VALUE</th></tr></thead>
                  <tbody>{dnsInstructions(d.hostname, d.detail.verification).map((r, i) => <tr key={i}><td>{r.type}</td><td>{r.name}</td><td>{r.value}</td></tr>)}</tbody>
                </table></div>
                {d.detail.error && <p className="monarch-alert is-error" role="alert">{d.detail.error}</p>}
              </>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              <form action={refreshDomainAction}><Hidden ctx={ctx} /><input type="hidden" name="domain_id" value={d.id} /><button className="monarch-secondary">Check now</button></form>
              <form action={removeDomainAction}><Hidden ctx={ctx} /><input type="hidden" name="domain_id" value={d.id} /><button className="monarch-secondary">Remove</button></form>
            </div>
          </div>
        ))}
      </section>
    </>
  );
}
