"use client";

import { useState } from "react";
import Link from "next/link";
import { FONT_CHOICES, SEO_LIMITS, SOCIALS, type FontChoice, type SiteSettings } from "@/lib/sites/settings.ts";
import { SettingRow } from "./setting-row";
import type { PickImage } from "./page-form";

// One website's settings on a single page, in plain parts: colours, logo and font; business details; header and footer; and how it
// shows in search and when shared. The whole thing is sent as a single field and checked again on the server.

const SOCIAL_LABEL: Record<string, string> = { facebook: "Facebook", instagram: "Instagram", linkedin: "LinkedIn", youtube: "YouTube", x: "X", tiktok: "TikTok" };
type Firm = { primary: string; accent: string; brandingHref: string };

export function SettingsForm({ action, area, siteId, initial, images, siteName, firm }: { action: (f: FormData) => void | Promise<void>; area: string; siteId: string; initial: SiteSettings; images: PickImage[]; siteName: string; firm: Firm }) {
  const [s, setS] = useState<SiteSettings>(initial);
  const patch = <K extends keyof SiteSettings>(k: K, v: Partial<SiteSettings[K]>) => setS((cur) => ({ ...cur, [k]: { ...(cur[k] as object), ...(v as object) } }));
  const own = s.brand.primary !== null || s.brand.accent !== null;
  const primary = s.brand.primary ?? firm.primary;
  const accent = s.brand.accent ?? firm.accent;
  const font = s.fonts.heading;
  const imageSelect = (value: string | null, onChange: (v: string | null) => void, none: string) => (
    <select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}><option value="">{none}</option>{images.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
  );
  return (
    <form action={action} className="sx-form">
      <input type="hidden" name="area" value={area} />
      <input type="hidden" name="site_id" value={siteId} />
      <input type="hidden" name="settings" value={JSON.stringify(s)} />

      <SettingRow title="Colours" desc="Used for buttons, links and banners across this website.">
        <div className="sx-card-panel">
          <label className="sx-check"><input type="radio" name="colours" checked={!own} onChange={() => patch("brand", { primary: null, accent: null })} /> <span>Use my firm&apos;s colours <i className="sx-swatch" style={{ background: firm.primary }} /><i className="sx-swatch" style={{ background: firm.accent }} /></span></label>
          <label className="sx-check"><input type="radio" name="colours" checked={own} onChange={() => patch("brand", { primary: primary, accent: accent })} /> <span>Choose colours for this website</span></label>
          {own && (
            <div className="sx-grid">
              <label>Main colour<span className="sx-color"><input type="color" value={primary} onChange={(e) => patch("brand", { primary: e.target.value })} /><code>{primary}</code></span></label>
              <label>Second colour<span className="sx-color"><input type="color" value={accent} onChange={(e) => patch("brand", { accent: e.target.value })} /><code>{accent}</code></span></label>
            </div>
          )}
          {firm.brandingHref && <p className="sx-hint">Your firm&apos;s colours are set under <Link href={firm.brandingHref}>Settings → Branding</Link>.</p>}
        </div>
      </SettingRow>

      <SettingRow title="Page background" desc="The colour behind every page of this website. Sections you colour yourself still show on top.">
        <div className="sx-card-panel">
          <label className="sx-check"><input type="radio" name="pagebg" checked={s.brand.pageBg === null} onChange={() => patch("brand", { pageBg: null })} /> <span>White</span></label>
          <label className="sx-check"><input type="radio" name="pagebg" checked={s.brand.pageBg !== null} onChange={() => patch("brand", { pageBg: s.brand.pageBg ?? "#f6f4ee" })} /> <span>Choose a colour</span></label>
          {s.brand.pageBg !== null && <label>Colour<span className="sx-color"><input type="color" value={s.brand.pageBg} onChange={(e) => patch("brand", { pageBg: e.target.value })} /><code>{s.brand.pageBg}</code></span></label>}
        </div>
      </SettingRow>

      <SettingRow title="Logo and font" desc="The logo goes at the top-left of every page.">
        <div className="sx-card-panel">
          <label>Logo{imageSelect(s.brand.logoImageId, (v) => patch("brand", { logoImageId: v }), "Use my firm's logo")}</label>
          <label>Font
            <select value={font} onChange={(e) => setS((c) => ({ ...c, fonts: { heading: e.target.value as FontChoice, body: e.target.value as FontChoice } }))}>
              {(Object.keys(FONT_CHOICES) as FontChoice[]).map((k) => <option key={k} value={k}>{FONT_CHOICES[k].label}</option>)}
            </select>
          </label>
          <p className="sx-sample" style={{ fontFamily: FONT_CHOICES[font].stack }}>The quick brown fox jumps over the lazy dog.</p>
          {images.length === 0 && <p className="sx-hint">To choose a logo, upload a picture from any page in the editor first.</p>}
        </div>
      </SettingRow>

      <SettingRow title="Business details" desc="Shown in the footer of every page. Leave a box empty to use the details from your firm profile.">
        <div className="sx-card-panel">
          <div className="sx-grid">
            <label>Phone<input value={s.contact.phone} maxLength={40} onChange={(e) => patch("contact", { phone: e.target.value })} /></label>
            <label>Email<input type="email" value={s.contact.email} maxLength={254} onChange={(e) => patch("contact", { email: e.target.value })} /></label>
          </div>
          <label>Address<textarea rows={2} maxLength={300} value={s.contact.address} onChange={(e) => patch("contact", { address: e.target.value })} /></label>
          <label>Office hours<textarea rows={3} maxLength={SEO_LIMITS.hours} value={s.hours} placeholder={"Mon–Fri 9am–5pm\nSat by appointment"} onChange={(e) => setS((c) => ({ ...c, hours: e.target.value }))} /></label>
          <details className="sx-details">
            <summary>Social media links</summary>
            <div className="sx-grid">
              {SOCIALS.map((k) => <label key={k}>{SOCIAL_LABEL[k]}<input value={s.social[k] ?? ""} maxLength={300} placeholder="https://…" onChange={(e) => setS((c) => ({ ...c, social: { ...c.social, [k]: e.target.value } }))} /></label>)}
            </div>
          </details>
        </div>
      </SettingRow>

      <SettingRow title="Header and footer" desc="The bar at the top of every page, and the area at the bottom.">
        <div className="sx-card-panel">
          <label className="sx-check"><input type="checkbox" checked={s.header.show} onChange={(e) => patch("header", { show: e.target.checked })} /> <span>Show the header (your name, logo and menu)</span></label>
          {s.header.show && (
            <div className="sx-grid">
              <label>Header button text <small>(optional)</small><input value={s.header.ctaLabel} maxLength={40} placeholder="Book a call" onChange={(e) => patch("header", { ctaLabel: e.target.value })} /></label>
              <label>Where the button goes<input value={s.header.ctaHref} maxLength={500} placeholder="/contact or https://…" onChange={(e) => patch("header", { ctaHref: e.target.value })} /></label>
            </div>
          )}
          <label className="sx-check"><input type="checkbox" checked={s.footer.show} onChange={(e) => patch("footer", { show: e.target.checked })} /> <span>Show the footer</span></label>
          {s.footer.show && <label>Footer note <small>(optional)</small><textarea rows={2} maxLength={SEO_LIMITS.footerText} value={s.footer.text} onChange={(e) => patch("footer", { text: e.target.value })} /></label>}
        </div>
      </SettingRow>

      <SettingRow title="Search and sharing" desc="How this website looks on Google and when someone shares a link. Each page can set its own too.">
        <div className="sx-card-panel">
          <label>Title <small>{s.seo.title.length}/{SEO_LIMITS.title}</small><input value={s.seo.title} maxLength={SEO_LIMITS.title} placeholder={siteName} onChange={(e) => patch("seo", { title: e.target.value })} /></label>
          <label>Description <small>{s.seo.description.length}/{SEO_LIMITS.description}</small><textarea rows={3} value={s.seo.description} maxLength={SEO_LIMITS.description} placeholder="One or two sentences about what you do." onChange={(e) => patch("seo", { description: e.target.value })} /></label>
          <label>Picture shown when shared{imageSelect(s.seo.shareImageId, (v) => patch("seo", { shareImageId: v }), "None")}</label>
          <div className="sx-serp" aria-label="How it may look on Google">
            <b>{s.seo.title || siteName}</b>
            <span>{s.seo.description || "Your description appears here."}</span>
          </div>
          <label className="sx-check"><input type="checkbox" checked={s.seo.noindex} onChange={(e) => patch("seo", { noindex: e.target.checked })} /> <span>Hide this whole website from search engines</span></label>
        </div>
      </SettingRow>

      <div className="sx-savebar">
        <span className="monarch-muted">Changes go live the next time you publish.</span>
        <button className="monarch-primary">Save settings</button>
      </div>
    </form>
  );
}
