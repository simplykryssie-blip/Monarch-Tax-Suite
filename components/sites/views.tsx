import Link from "next/link";
import { Flash } from "@/components/admin/ui";
import { Modal } from "@/components/ui/modal";
import { PageEditor } from "@/components/sites/page-editor";
import type { PickBooking, PickForm, PickImage } from "@/components/sites/page-form";
import { appointmentDeps } from "@/lib/appointments/server";
import { dnsInstructions, platformDomain } from "@/lib/sites/domains.ts";
import { SupabaseFormsRepo } from "@/lib/forms/supabase-repo";
import { SupabaseImagesRepo } from "@/lib/images/supabase-repo";
import { viewFor } from "@/lib/sites/public";
import type { SiteContext, SitesContext } from "@/lib/sites/context";
import { SettingsForm } from "@/components/sites/settings-form";
import { sectionsOf } from "@/lib/sites/blocks.ts";
import { cleanPageSeo, settingsOf } from "@/lib/sites/settings.ts";
import { MAX_SITES } from "@/lib/sites/service.ts";
import { hasUnpublishedChanges, MAX_CUSTOM_DOMAINS, MAX_PAGES } from "@/lib/sites/service.ts";
import { vercelProblems } from "@/lib/sites/vercel.ts";
import { tenantClient } from "@/lib/supabase/service";
import { addDomainAction, addPageAction, createSiteAction, deleteSiteAction, renameSiteAction, saveSiteSettingsAction, movePageAction, publishAction, refreshDomainAction, removeDomainAction, removePageAction, savePageAction, setSubdomainAction, unpublishAction } from "@/app/sites-actions";
import { uploadSiteImageAction } from "@/app/sites-image-actions";

type Search = { notice?: string; error?: string };

const Hidden = ({ ctx }: { ctx: SitesContext | SiteContext }) => (
  <>
    <input type="hidden" name="area" value={ctx.area} />
    {"site" in ctx && <input type="hidden" name="site_id" value={ctx.site.id} />}
  </>
);
const STATUS: Record<string, string> = { active: "Connected", pending: "Waiting for DNS", error: "Needs attention" };

/** The website's name, whether it is live, its address, the Publish button, and the Pages / Site settings tabs. */
async function SiteHeader({ ctx, here }: { ctx: SiteContext; here: "pages" | "settings" }) {
  const [pages, domains] = await Promise.all([ctx.deps.repo.listPages(ctx.site.id), ctx.deps.repo.listDomains(ctx.site.id)]);
  const live = ctx.site.status === "published";
  const changed = hasUnpublishedChanges(pages, ctx.site);
  const host = domains.find((d) => d.kind === "custom" && d.status === "active") ?? domains.find((d) => d.kind === "subdomain");
  const tab = (key: typeof here, href: string, label: string) => <Link href={href} className={here === key ? "is-on" : undefined} aria-current={here === key ? "page" : undefined}>{label}</Link>;
  return (
    <header className="sx-head">
      <Link className="sx-back" href={ctx.base}>← All websites</Link>
      <div className="sx-head-main">
        <div>
          <h1>{ctx.site.name}</h1>
          <p className="sx-meta">
            <span className={`sx-pill ${live ? "is-live" : ""}`}>{live ? "Live" : "Not published"}</span>
            {host && (live ? <a href={`https://${host.hostname}`} target="_blank" rel="noreferrer">{host.hostname}</a> : <span>{host.hostname}</span>)}
            {changed && <span className="sx-note">{live ? "Unpublished changes" : "Nothing is public yet"}</span>}
          </p>
        </div>
        <div className="sx-actions">
          {live && <form action={unpublishAction}><Hidden ctx={ctx} /><button className="monarch-secondary">Take offline</button></form>}
          <form action={publishAction}><Hidden ctx={ctx} /><button className="monarch-primary">{live ? "Publish changes" : "Publish"}</button></form>
        </div>
      </div>
      <nav className="sx-tabs" aria-label="Website">
        {tab("pages", ctx.siteBase, "Pages")}
        {tab("settings", `${ctx.siteBase}/settings`, "Site settings")}
      </nav>
    </header>
  );
}

/** The list of the office's websites, as cards, with a pop-up to start another. */
export async function SitesList({ ctx, sp }: { ctx: SitesContext; sp: Search }) {
  const sites = await ctx.deps.repo.listSites();
  const rows = await Promise.all(sites.map(async (site) => ({ site, domains: await ctx.deps.repo.listDomains(site.id) })));
  return (
    <div className="sx">
      <div className="sx-title">
        <div><h1>Websites</h1><p className="sx-lead">Each website has its own pages, look, search details and addresses.</p></div>
        {rows.length < MAX_SITES && (
          <Modal label="New website" title="New website">
            <form action={createSiteAction} className="monarch-form">
              <Hidden ctx={ctx} />
              <label className="is-wide">Website name<input name="name" required maxLength={80} placeholder="For example, Smith Tax Services" autoFocus /></label>
              <p className="monarch-muted is-wide">It starts blank, with a free address and an empty home page. Nothing is public until you publish.</p>
              <div className="is-wide"><button className="monarch-primary">Create website</button></div>
            </form>
          </Modal>
        )}
      </div>
      <Flash notice={sp.notice} error={sp.error} />
      {rows.length === 0 && <div className="sx-empty"><b>No websites yet</b><p>Create your first one to get started.</p></div>}
      <ul className="sx-cards">
        {rows.map(({ site, domains }) => {
          const host = domains.find((d) => d.kind === "custom" && d.status === "active") ?? domains.find((d) => d.kind === "subdomain");
          const live = site.status === "published";
          return (
            <li key={site.id} className="sx-card">
              <Link href={`${ctx.base}/${site.id}`} className="sx-card-top" aria-label={`Open ${site.name}`}>
                <span className="sx-initial">{site.name.trim().charAt(0).toUpperCase() || "W"}</span>
                <span className={`sx-pill ${live ? "is-live" : ""}`}>{live ? "Live" : "Not published"}</span>
              </Link>
              <div className="sx-card-body">
                <h2>{site.name}</h2>
                <p>{host?.hostname ?? "No address yet"}</p>
              </div>
              <div className="sx-card-foot">
                <Link className="monarch-primary" href={`${ctx.base}/${site.id}`}>Open</Link>
                <details className="sx-more">
                  <summary aria-label={`More for ${site.name}`}>⋯</summary>
                  <div className="sx-more-menu">
                    <form action={deleteSiteAction}>
                      <Hidden ctx={ctx} /><input type="hidden" name="site_id" value={site.id} />
                      <label>Type DELETE to remove it<input name="confirm" required placeholder="DELETE" /></label>
                      <button className="monarch-secondary is-danger">Delete website</button>
                    </form>
                  </div>
                </details>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** One website's settings: its name and addresses, look, header and footer, contact, and search details, in one place. */
export async function SiteSettingsView({ ctx, sp }: { ctx: SiteContext; sp: Search }) {
  const pick = await pickers(ctx);
  const general = (
    <>
      <section className="sx-card-panel">
        <h2>Website name</h2>
        <form action={renameSiteAction} className="sx-inline"><Hidden ctx={ctx} /><input name="name" required maxLength={80} defaultValue={ctx.site.name} aria-label="Website name" /><button className="monarch-secondary">Rename</button></form>
      </section>
      <Addresses ctx={ctx} />
    </>
  );
  return (
    <div className="sx">
      <SiteHeader ctx={ctx} here="settings" />
      <Flash notice={sp.notice} error={sp.error} />
      <SettingsForm action={saveSiteSettingsAction} area={ctx.area} siteId={ctx.site.id} initial={settingsOf(ctx.site.settings ?? {})} images={pick.images} siteName={ctx.site.name} general={general} />
    </div>
  );
}

export async function SitesOverview({ ctx, sp }: { ctx: SiteContext; sp: Search }) {
  const pages = await ctx.deps.repo.listPages(ctx.site.id);
  const sorted = pages.slice().sort((a, b) => a.position - b.position);
  return (
    <div className="sx">
      <SiteHeader ctx={ctx} here="pages" />
      <Flash notice={sp.notice} error={sp.error} />
      <div className="sx-section-head">
        <div><h2>Pages</h2><p className="sx-lead">The menu follows this order.</p></div>
        {pages.length < MAX_PAGES && (
          <Modal label="Add a page" title="Add a page" className="monarch-secondary">
            <form action={addPageAction} className="monarch-form">
              <Hidden ctx={ctx} />
              <label className="is-wide">Page name<input name="title" required maxLength={120} placeholder="For example, About us" autoFocus /></label>
              <p className="monarch-muted is-wide">It starts blank. You&apos;ll add its content next.</p>
              <div className="is-wide"><button className="monarch-primary">Add page</button></div>
            </form>
          </Modal>
        )}
      </div>
      <ul className="sx-rows">
        {sorted.map((p, i) => (
          <li key={p.id} className="sx-row">
            <Link href={`${ctx.siteBase}/pages/${p.id}`} className="sx-row-main">
              <b>{p.title}</b>
              <span>{p.is_home ? "Home page" : `/${p.slug}`}</span>
            </Link>
            <span className="sx-chips">
              {p.published === null && <span className="sx-chip is-warn">Draft</span>}
              <span className="sx-chip">{p.show_in_nav ? "In menu" : "Not in menu"}</span>
            </span>
            <span className="sx-row-actions">
              <Link className="monarch-secondary" href={`${ctx.siteBase}/pages/${p.id}`}>Edit</Link>
              {!p.is_home && (
                <details className="sx-more">
                  <summary aria-label={`More for ${p.title}`}>⋯</summary>
                  <div className="sx-more-menu">
                    {i > 1 && <form action={movePageAction}><Hidden ctx={ctx} /><input type="hidden" name="page_id" value={p.id} /><input type="hidden" name="direction" value="up" /><button>Move up in the menu</button></form>}
                    {i < sorted.length - 1 && <form action={movePageAction}><Hidden ctx={ctx} /><input type="hidden" name="page_id" value={p.id} /><input type="hidden" name="direction" value="down" /><button>Move down in the menu</button></form>}
                    <form action={removePageAction}><Hidden ctx={ctx} /><input type="hidden" name="page_id" value={p.id} /><button className="is-danger">Remove page</button></form>
                  </div>
                </details>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

async function pickers(ctx: SitesContext | SiteContext) {
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

export async function PageEditorView({ ctx, id, sp }: { ctx: SiteContext; id: string; sp: Search }) {
  const page = await ctx.deps.repo.getPage(id);
  if (!page || page.site_id !== ctx.site.id) return <><h1 className="office-h1">Page not found</h1><p><Link href={ctx.siteBase}>Back to your website</Link></p></>;
  const [pick, pages] = await Promise.all([pickers(ctx), ctx.deps.repo.listPages(ctx.site.id)]);
  const view = await viewFor(ctx.tenantId, ctx.site.name, pages, page.draft, settingsOf(ctx.site.settings ?? {}));
  return (
    <>
      <Flash notice={sp.notice} error={sp.error} />
      <PageEditor
        action={savePageAction} area={ctx.area} siteId={ctx.site.id} pageId={page.id} seo={cleanPageSeo(page.seo ?? {})} title={page.title} description={page.description ?? ""} showInNav={page.show_in_nav} isHome={page.is_home}
        initial={sectionsOf(page.draft)} images={pick.images} bookings={pick.bookings} forms={pick.forms} view={view}
        backHref={ctx.siteBase} siteName={ctx.site.name} uploadImage={uploadSiteImageAction}
      />
    </>
  );
}


async function Addresses({ ctx }: { ctx: SiteContext }) {
  const domains = await ctx.deps.repo.listDomains(ctx.site.id);
  const sub = domains.find((d) => d.kind === "subdomain");
  const custom = domains.filter((d) => d.kind === "custom");
  const platform = platformDomain();
  const problems = vercelProblems(process.env);
  return (
    <>
      <section className="sx-card-panel">
        <h2>Your free address</h2>
        <p>Every website gets an address on {platform} automatically. You can change the first part; the old address stops working right away.</p>
        <form action={setSubdomainAction} className="sx-inline">
          <Hidden ctx={ctx} />
          <input name="label" required defaultValue={ctx.site.slug} maxLength={40} aria-label="Address" /> <span>.{platform}</span>
          <button className="monarch-secondary">Change</button>
        </form>
        {sub && <p className="monarch-muted">Currently <b>{sub.hostname}</b>.</p>}
      </section>
      <section className="sx-card-panel">
        <h2>Your own domain</h2>
        <p>Connect a domain you own, such as <b>www.yourfirm.com</b>. You&apos;ll add one or two records at the company where you bought it. Your free address keeps working.</p>
        {problems.length > 0 && <p className="monarch-notice" role="note"><b>NOT TURNED ON</b> Connecting your own domain isn&apos;t set up on this deployment yet: {problems.join(" ")}</p>}
        {custom.length < MAX_CUSTOM_DOMAINS && (
          <form action={addDomainAction} className="sx-inline"><Hidden ctx={ctx} /><input name="host" required maxLength={253} placeholder="www.yourfirm.com" aria-label="Your domain" /><button className="monarch-primary" disabled={problems.length > 0}>Connect domain</button></form>
        )}
        {custom.map((d) => (
          <div key={d.id} className="sx-domain">
            <div className="sx-meta"><b>{d.hostname}</b><span>{STATUS[d.status]}</span></div>
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
            <div className="sx-inline">
              <form action={refreshDomainAction}><Hidden ctx={ctx} /><input type="hidden" name="domain_id" value={d.id} /><button className="monarch-secondary">Check now</button></form>
              <form action={removeDomainAction}><Hidden ctx={ctx} /><input type="hidden" name="domain_id" value={d.id} /><button className="monarch-secondary">Remove</button></form>
            </div>
          </div>
        ))}
      </section>
    </>
  );
}
