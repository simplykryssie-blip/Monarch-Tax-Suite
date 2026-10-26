import Link from "next/link";
import { LAYOUTS, sectionsOf, type Block, type LeafBlock } from "@/lib/sites/blocks.ts";
import { onColor } from "@/lib/forms/theme.ts";
import { HtmlEmbed } from "./html-embed";

// How a published page looks. Server-rendered, plain HTML and CSS only (no script of ours; custom HTML blocks run only inside a sandboxed frame), mobile first: the layout is a single
// column that widens at larger screens, and nothing is wider than the screen at 390px. Content is escaped by React; the
// only attributes taken from block data are links that were checked when saved and are checked again here.

export type SiteImage = { url: string; width: number | null; height: number | null };
export type SiteView = {
  name: string;
  primary: string;
  accent: string;
  logoUrl: string | null;
  nav: { href: string; label: string }[];
  contact: { phone: string | null; email: string | null; address: string | null };
  images: Record<string, SiteImage>;
  /** Fonts, header and footer choices, hours and social links from the website's settings. */
  look?: {
    headingFont: string; bodyFont: string;
    header: { show: boolean; align: "left" | "center"; showPhone: boolean; ctaLabel: string; ctaHref: string };
    footer: { show: boolean; text: string; showContact: boolean; showHours: boolean; showSocial: boolean };
    hours: string; social: { label: string; href: string }[];
  };
  /** In the editor: booking pages and forms are described instead of loaded (they belong to the live address). */
  preview?: boolean;
  /** "" on a website address; "/s/<address>" when a Preview shows the site on the deployment's own address. */
  base?: string;
};

const SAFE_LINK = /^(\/(?!\/)[A-Za-z0-9\-._~/?#=&%]*|https:\/\/[^\s"'<>]+|mailto:[^\s"'<>]+|tel:[+0-9\-.() ]+)$/;
const hrefOf = (h: string, base = "") => (SAFE_LINK.test(h) ? (h.startsWith("/") ? `${base}${h === "/" && base ? "" : h}` || "/" : h) : "#");
const external = (h: string) => h.startsWith("https://");

function Paragraphs({ text }: { text: string }) {
  return <>{text.split(/\n{2,}/).map((p, i) => <p key={i}>{p.split("\n").map((line, j) => <span key={j}>{j > 0 && <br />}{line}</span>)}</p>)}</>;
}

export function Leaf({ block, view }: { block: LeafBlock; view: SiteView }) {
  switch (block.type) {
    case "heading": {
      const H = (`h${block.level}`) as "h1" | "h2" | "h3";
      return <H className={`ws-h ws-a-${block.align}`}>{block.text}</H>;
    }
    case "text":
      return <div className={`ws-text ws-a-${block.align}`}><Paragraphs text={block.text} /></div>;
    case "image": {
      const img = view.images[block.imageId];
      if (!img) return null;
      return (
        <figure className={`ws-img ws-img-${block.size}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={img.url} alt={block.alt} width={img.width ?? undefined} height={img.height ?? undefined} loading="lazy" decoding="async" />
        </figure>
      );
    }
    case "button":
      return (
        <p className={`ws-a-${block.align}`}>
          <a className={`ws-btn ws-btn-${block.style}`} href={hrefOf(block.href, view.base)} {...(external(block.href) ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{block.label}</a>
        </p>
      );
    case "booking":
      if (view.preview) return <p className="ws-ph">Booking page “{block.slug}” appears here on your live site.</p>;
      return <iframe className="ws-frame" title="Book an appointment" src={`/book/${encodeURIComponent(block.slug)}`} style={{ height: block.height }} loading="lazy" />;
    case "form":
      if (view.preview) return <p className="ws-ph">Your form appears here on your live site.</p>;
      return <iframe className="ws-frame" title="Form" src={`/f/${encodeURIComponent(block.formId)}`} style={{ height: block.height }} loading="lazy" />;
    case "html":
      if (view.preview) return <p className="ws-ph">Your custom HTML appears here on your live site.</p>;
      return <HtmlEmbed code={block.code} height={block.height} />;
    case "spacer":
      return <div className={`ws-space ws-space-${block.size}`} aria-hidden="true" />;
    case "divider":
      return <hr className="ws-hr" />;
  }
}

/** The page's sections, rows and columns. Older pages (loose elements, one-column sections) are converted on the way in. */
export function Blocks({ blocks, view }: { blocks: Block[]; view: SiteView }) {
  return (
    <>
      {sectionsOf(blocks).map((s) => (
        <section key={s.id} className={`ws-section ws-tone-${s.tone} ws-pad-${s.pad}`}>
          <div className={`ws-wrap ws-w-${s.width}`}>
            {s.rows.map((r) => (
              <div key={r.id} className={`ws-row ws-gap-${r.gap} ws-va-${r.valign} ws-cols-${r.columns.length}`} style={{ gridTemplateColumns: LAYOUTS[r.layout].map((n) => `${n}fr`).join(" ") }}>
                {r.columns.map((c) => <div key={c.id} className="ws-col">{c.children.map((e) => <Leaf key={e.id} block={e} view={view} />)}</div>)}
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

export const SITE_CSS = `
.ws{--p:var(--ws-primary,#2563eb);--on-p:var(--ws-on-primary,#fff);--a:var(--ws-accent,#171714);margin:0;min-height:100vh;display:flex;flex-direction:column;background:#fff;color:#1c1b17;font:16px/1.65 var(--ws-body-font,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif);-webkit-text-size-adjust:100%}
.ws h1,.ws h2,.ws h3{font-family:var(--ws-heading-font,inherit)}
.ws *,.ws *::before,.ws *::after{box-sizing:border-box}
.ws a{color:var(--p)}
.ws-header{border-bottom:1px solid #e7e5de;background:#fff}
.ws-header-in{max-width:1040px;margin:0 auto;padding:12px 16px;display:flex;flex-wrap:wrap;align-items:center;gap:8px 20px}
.ws-brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:18px;color:var(--a)!important;text-decoration:none}
.ws-brand img{max-height:40px;width:auto;max-width:160px;height:auto}
.ws-nav{display:flex;flex-wrap:wrap;gap:4px 14px;margin:0;padding:0;list-style:none}
.ws-nav a{display:inline-block;padding:6px 2px;color:#1c1b17;text-decoration:none;font-weight:600;font-size:15px}
.ws-nav a:hover,.ws-nav a[aria-current="page"]{color:var(--p);text-decoration:underline}
.ws main{flex:1}
.ws-wrap{max-width:760px;margin:0 auto;padding:0 16px}
.ws-section{padding:28px 0}
.ws-pad-none{padding:0}.ws-pad-small{padding:14px 0}.ws-pad-large{padding:64px 0}
.ws-w-wide{max-width:1040px}.ws-w-full{max-width:none}
.ws-row{display:grid;gap:0 24px;min-width:0}
.ws-gap-small{column-gap:12px}.ws-gap-large{column-gap:48px}
.ws-va-center{align-items:center}
.ws-col{min-width:0}
@media (max-width:900px){.ws-row.ws-cols-3,.ws-row.ws-cols-4{grid-template-columns:1fr 1fr!important}}
@media (max-width:600px){.ws-row{grid-template-columns:1fr!important}}
.ws-dev-tablet .ws-row.ws-cols-3,.ws-dev-tablet .ws-row.ws-cols-4{grid-template-columns:1fr 1fr!important}
.ws-dev-mobile .ws-row{grid-template-columns:1fr!important}
.ws-tone-soft{background:#f5f3ec}
.ws-tone-accent{background:var(--p);color:var(--on-p)}
.ws-tone-accent a:not(.ws-btn){color:var(--on-p)}
.ws-tone-dark{background:#14130f;color:#f3f1ea}
.ws-tone-dark a:not(.ws-btn){color:#f3f1ea}
.ws-h{line-height:1.2;margin:1.2em 0 .4em;overflow-wrap:anywhere}
h1.ws-h{font-size:clamp(28px,7vw,44px)}
h2.ws-h{font-size:clamp(22px,5.5vw,32px)}
h3.ws-h{font-size:clamp(18px,4.5vw,22px)}
.ws-text p{margin:.8em 0;overflow-wrap:anywhere}
.ws-a-center{text-align:center}
.ws-img{margin:1em 0}
.ws-img img{display:block;max-width:100%;height:auto;border-radius:6px}
.ws-img-half{max-width:50%}
.ws-a-center .ws-img img,.ws-img-half{margin-left:auto;margin-right:auto}
@media (max-width:520px){.ws-img-half{max-width:100%}}
.ws-btn{display:inline-block;min-height:44px;padding:11px 22px;border-radius:6px;font-weight:700;text-decoration:none;text-align:center;border:2px solid var(--p)}
.ws-btn-primary{background:var(--p);color:var(--on-p)!important}
.ws-btn-secondary{background:transparent;color:var(--p)!important}
.ws-tone-accent .ws-btn-primary{background:var(--on-p);color:var(--p)!important;border-color:var(--on-p)}
.ws-tone-accent .ws-btn-secondary{color:var(--on-p)!important;border-color:var(--on-p)}
.ws-ph{border:2px dashed #b9b4a4;border-radius:6px;padding:18px;text-align:center;color:#4a483f;margin:1em 0}
.ws-frame{display:block;width:100%;border:0;margin:1em 0;background:#fff;border-radius:6px}
.ws-space-small{height:12px}.ws-space-medium{height:28px}.ws-space-large{height:56px}
.ws-hr{border:0;border-top:1px solid #d9d4c7;margin:1.5em 0}
.ws-footer{border-top:1px solid #e7e5de;background:#faf9f5;font-size:14px;color:#4a483f}
.ws-footer-in{max-width:1040px;margin:0 auto;padding:20px 16px;display:grid;gap:4px}
.ws-footer a{color:inherit}
@media (min-width:700px){.ws-wrap{padding:0 24px}.ws-header-in{padding:14px 24px}}
`;

const fontVars = (view: SiteView): Record<string, string> => (view.look ? { "--ws-heading-font": view.look.headingFont, "--ws-body-font": view.look.bodyFont } : {});

/** The colour and font variables a site's styles read, for a wrapper element. */
export const siteVars = (view: SiteView): React.CSSProperties => ({ "--ws-primary": view.primary, "--ws-on-primary": onColor(view.primary), "--ws-accent": view.accent, ...fontVars(view) } as React.CSSProperties);

export function SiteFrame({ view, currentPath, children }: { view: SiteView; currentPath: string; children: React.ReactNode }) {
  return (
    <div className="ws" style={{ "--ws-primary": view.primary, "--ws-on-primary": onColor(view.primary), "--ws-accent": view.accent, ...fontVars(view) } as React.CSSProperties}>
      <style dangerouslySetInnerHTML={{ __html: SITE_CSS }} />
      {(view.look?.header.show ?? true) && <header className="ws-header">
        <div className="ws-header-in" style={view.look?.header.align === "center" ? { flexDirection: "column", justifyContent: "center" } : undefined}>
          <Link className="ws-brand" href={view.base || "/"}>
            {view.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={view.logoUrl} alt="" />
            )}
            <span>{view.name}</span>
          </Link>
          {view.nav.length > 1 && (
            <nav aria-label="Pages"><ul className="ws-nav">{view.nav.map((n) => <li key={n.href}><Link href={n.href === "/" ? view.base || "/" : `${view.base ?? ""}${n.href}`} {...(n.href === currentPath ? { "aria-current": "page" as const } : {})}>{n.label}</Link></li>)}</ul></nav>
          )}
          {view.look?.header.showPhone && view.contact.phone && <a href={`tel:${view.contact.phone.replace(/[^0-9+]/g, "")}`}>{view.contact.phone}</a>}
          {view.look?.header.ctaLabel && view.look.header.ctaHref && <a className="ws-btn ws-btn-primary" href={hrefOf(view.look.header.ctaHref, view.base)} {...(external(view.look.header.ctaHref) ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{view.look.header.ctaLabel}</a>}
        </div>
      </header>}
      <main>{children}</main>
      {(view.look?.footer.show ?? true) && <footer className="ws-footer">
        <div className="ws-footer-in">
          <strong>{view.name}</strong>
          {view.look?.footer.text && <span style={{ whiteSpace: "pre-line" }}>{view.look.footer.text}</span>}
          {(view.look?.footer.showContact ?? true) && <>
            {view.contact.address && <span style={{ whiteSpace: "pre-line" }}>{view.contact.address}</span>}
            {view.contact.phone && <span><a href={`tel:${view.contact.phone.replace(/[^0-9+]/g, "")}`}>{view.contact.phone}</a></span>}
            {view.contact.email && <span><a href={`mailto:${view.contact.email}`}>{view.contact.email}</a></span>}
          </>}
          {(view.look?.footer.showHours ?? true) && view.look?.hours && <span style={{ whiteSpace: "pre-line" }}>{view.look.hours}</span>}
          {(view.look?.footer.showSocial ?? true) && view.look && view.look.social.length > 0 && <span>{view.look.social.map((s, i) => <span key={s.label}>{i > 0 && " · "}<a href={s.href} target="_blank" rel="noopener noreferrer">{s.label}</a></span>)}</span>}
        </div>
      </footer>}
    </div>
  );
}

/** The page body inside the site's look, without the header and footer: the preview in the editor. */
export function SitePreview({ view, blocks }: { view: SiteView; blocks: Block[] }) {
  return (
    <div className="ws" style={{ "--ws-primary": view.primary, "--ws-on-primary": onColor(view.primary), "--ws-accent": view.accent, ...fontVars(view), minHeight: 0 } as React.CSSProperties}>
      <style dangerouslySetInnerHTML={{ __html: SITE_CSS }} />
      <Blocks blocks={blocks} view={{ ...view, preview: true }} />
    </div>
  );
}
