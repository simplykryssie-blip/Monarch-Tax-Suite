"use client";

import { useState } from "react";
import { FONT_CHOICES, SEO_LIMITS, SOCIALS, type FontChoice, type SiteSettings } from "@/lib/sites/settings.ts";
import type { PickImage } from "./page-form";

// One website's settings, in four small tabs so the page stays calm. The whole thing is sent as a single field and
// checked again on the server; nothing here is trusted.

const TABS = ["General", "Look & feel", "Header & footer", "Contact & hours", "Search (SEO)"] as const;
const SOCIAL_LABEL: Record<string, string> = { facebook: "Facebook", instagram: "Instagram", linkedin: "LinkedIn", youtube: "YouTube", x: "X", tiktok: "TikTok" };

export function SettingsForm({ action, area, siteId, initial, images, siteName, general }: { action: (f: FormData) => void | Promise<void>; area: string; siteId: string; initial: SiteSettings; images: PickImage[]; siteName: string; general: React.ReactNode }) {
  const [s, setS] = useState<SiteSettings>(initial);
  const [tab, setTab] = useState<(typeof TABS)[number]>(TABS[0]);
  const patch = <K extends keyof SiteSettings>(k: K, v: Partial<SiteSettings[K]>) => setS((cur) => ({ ...cur, [k]: { ...(cur[k] as object), ...(v as object) } }));
  const imageSelect = (value: string | null, onChange: (v: string | null) => void, none: string) => (
    <select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}><option value="">{none}</option>{images.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
  );
  const fontSelect = (value: FontChoice, onChange: (v: FontChoice) => void) => (
    <select value={value} onChange={(e) => onChange(e.target.value as FontChoice)}>{(Object.keys(FONT_CHOICES) as FontChoice[]).map((k) => <option key={k} value={k}>{FONT_CHOICES[k].label}</option>)}</select>
  );
  const nav = (
    <nav className="cl-tabs" aria-label="Website settings" role="tablist">
      {TABS.map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "is-on" : undefined} onClick={() => setTab(t)}>{t}</button>)}
    </nav>
  );
  // The name and addresses have forms of their own, so they sit outside this form; the tab state is shared.
  if (tab === "General") return <div>{nav}{general}</div>;
  return (
    <form action={action} className="monarch-form se-form monarch-panel" style={{ padding: 20 }}>
      <input type="hidden" name="area" value={area} />
      <input type="hidden" name="site_id" value={siteId} />
      <input type="hidden" name="settings" value={JSON.stringify(s)} />
      <div className="is-wide">{nav}</div>

      {tab === "Look & feel" && (
        <div className="se-fields is-wide">
          <label>Main colour<input type="color" value={s.brand.primary ?? "#2563eb"} onChange={(e) => patch("brand", { primary: e.target.value })} /></label>
          <label>Second colour<input type="color" value={s.brand.accent ?? "#171714"} onChange={(e) => patch("brand", { accent: e.target.value })} /></label>
          <label className="se-check"><input type="checkbox" checked={s.brand.primary === null && s.brand.accent === null} onChange={(e) => e.target.checked && patch("brand", { primary: null, accent: null })} /> Use my firm&apos;s brand colours</label>
          <label className="se-wide">Logo{imageSelect(s.brand.logoImageId, (v) => patch("brand", { logoImageId: v }), "Use my firm's logo")}</label>
          <label className="se-wide">Browser tab icon{imageSelect(s.brand.faviconImageId, (v) => patch("brand", { faviconImageId: v }), "None")}</label>
          <label>Heading font{fontSelect(s.fonts.heading, (v) => patch("fonts", { heading: v }))}</label>
          <label>Text font{fontSelect(s.fonts.body, (v) => patch("fonts", { body: v }))}</label>
          {images.length === 0 && <p className="monarch-muted se-wide">No pictures yet. Upload one from any page editor, then choose it here.</p>}
        </div>
      )}

      {tab === "Header & footer" && (
        <div className="se-fields is-wide">
          <label className="se-check se-wide"><input type="checkbox" checked={s.header.show} onChange={(e) => patch("header", { show: e.target.checked })} /> Show the header (name, logo and menu)</label>
          <label>Header layout<select value={s.header.align} onChange={(e) => patch("header", { align: e.target.value as "left" | "center" })}><option value="left">Left</option><option value="center">Centered</option></select></label>
          <label className="se-check"><input type="checkbox" checked={s.header.showPhone} onChange={(e) => patch("header", { showPhone: e.target.checked })} /> Show my phone number</label>
          <label>Header button text<input value={s.header.ctaLabel} maxLength={40} placeholder="Book a call" onChange={(e) => patch("header", { ctaLabel: e.target.value })} /></label>
          <label>Header button goes to<input value={s.header.ctaHref} maxLength={500} placeholder="/contact, https://…, tel:+1…" onChange={(e) => patch("header", { ctaHref: e.target.value })} /></label>
          <label className="se-check se-wide"><input type="checkbox" checked={s.footer.show} onChange={(e) => patch("footer", { show: e.target.checked })} /> Show the footer</label>
          <label className="se-wide">Footer note<textarea rows={3} maxLength={SEO_LIMITS.footerText} value={s.footer.text} onChange={(e) => patch("footer", { text: e.target.value })} /></label>
          <label className="se-check"><input type="checkbox" checked={s.footer.showContact} onChange={(e) => patch("footer", { showContact: e.target.checked })} /> Contact details</label>
          <label className="se-check"><input type="checkbox" checked={s.footer.showHours} onChange={(e) => patch("footer", { showHours: e.target.checked })} /> Office hours</label>
          <label className="se-check"><input type="checkbox" checked={s.footer.showSocial} onChange={(e) => patch("footer", { showSocial: e.target.checked })} /> Social links</label>
        </div>
      )}

      {tab === "Contact & hours" && (
        <div className="se-fields is-wide">
          <p className="monarch-muted se-wide">Leave a field blank to use the details from your firm profile.</p>
          <label>Phone<input value={s.contact.phone} maxLength={40} onChange={(e) => patch("contact", { phone: e.target.value })} /></label>
          <label>Email<input type="email" value={s.contact.email} maxLength={254} onChange={(e) => patch("contact", { email: e.target.value })} /></label>
          <label className="se-wide">Address<textarea rows={3} maxLength={300} value={s.contact.address} onChange={(e) => patch("contact", { address: e.target.value })} /></label>
          <label className="se-wide">Office hours<textarea rows={4} maxLength={SEO_LIMITS.hours} value={s.hours} placeholder={"Mon–Fri 9am–5pm\nSat by appointment"} onChange={(e) => setS((c) => ({ ...c, hours: e.target.value }))} /></label>
          {SOCIALS.map((k) => <label key={k}>{SOCIAL_LABEL[k]} link<input value={s.social[k] ?? ""} maxLength={300} placeholder="https://…" onChange={(e) => setS((c) => ({ ...c, social: { ...c.social, [k]: e.target.value } }))} /></label>)}
        </div>
      )}

      {tab === "Search (SEO)" && (
        <div className="se-fields is-wide">
          <p className="monarch-muted se-wide">These apply to every page that doesn&apos;t set its own. Each page also has its own search settings in its editor.</p>
          <label className="se-wide">Home page search title <small>({s.seo.title.length}/{SEO_LIMITS.title})</small><input value={s.seo.title} maxLength={SEO_LIMITS.title} placeholder={siteName} onChange={(e) => patch("seo", { title: e.target.value })} /></label>
          <label className="se-wide">Search description <small>({s.seo.description.length}/{SEO_LIMITS.description})</small><textarea rows={3} value={s.seo.description} maxLength={SEO_LIMITS.description} onChange={(e) => patch("seo", { description: e.target.value })} /></label>
          <label>Added after other page titles<input value={s.seo.titleSuffix} maxLength={40} placeholder={siteName} onChange={(e) => patch("seo", { titleSuffix: e.target.value })} /></label>
          <label>Picture shown when shared{imageSelect(s.seo.shareImageId, (v) => patch("seo", { shareImageId: v }), "None")}</label>
          <label className="se-check se-wide"><input type="checkbox" checked={s.seo.noindex} onChange={(e) => patch("seo", { noindex: e.target.checked })} /> Hide this whole website from search engines</label>
          <div className="se-wide se-serp" aria-label="Search result preview">
            <b>{s.seo.title || siteName}</b>
            <span>{s.seo.description || "Your description appears here."}</span>
          </div>
        </div>
      )}
      <div className="is-wide"><button className="monarch-primary">Save settings</button> <span className="monarch-muted">Changes go live the next time you publish this website.</span></div>
    </form>
  );
}
