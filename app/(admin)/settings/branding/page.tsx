/* eslint-disable @next/next/no-img-element */
import { requireAdmin } from "@/lib/admin";
import { brandOf } from "@/lib/branding/brand.ts";
import { brandRepo } from "@/lib/branding/server";
import { documentDeps } from "@/lib/documents/server";
import { PLATFORM } from "@/lib/platform-brand";
import { Flash, load, PageTitle, SetupRequired, when } from "@/components/admin/ui";
import { SubmitOnce } from "@/components/admin/submit-once";
import { ColorField } from "@/components/forms/color-field";
import { saveBrandingAction } from "../actions";

export default async function BrandingPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireAdmin();
  const { notice, error } = await searchParams;
  const result = await load(async () => ({ row: await brandRepo().get(), profile: await documentDeps().repo.getProfile().catch(() => null) }));
  const row = result.ok ? result.data.row : null;
  const b = brandOf(row, result.ok ? result.data.profile?.display_name : null);
  return (
    <>
      <PageTitle title="Branding">Make {PLATFORM.name} look like your own firm. Your name, logo and colors go on everything your clients and customers see (emails, forms, documents). Every form and email still ends with a small &ldquo;Powered by {PLATFORM.name}&rdquo; line.</PageTitle>
      <Flash notice={notice} error={error} />
      {!result.ok ? <SetupRequired message={result.message} /> : (
        <>
          <section className="monarch-panel" style={{ padding: 20 }}>
            <h2>How it looks now</h2>
            <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))" }}>
              <div style={{ borderRadius: 12, overflow: "hidden", border: "1px solid #e7e5de" }}>
                <div style={{ background: b.primary, color: "#fff", padding: "14px 16px", display: "flex", alignItems: "center", gap: 10 }}>
                  {b.logoUrl ? <img src={b.logoUrl} alt="" style={{ maxHeight: 34, maxWidth: 160, objectFit: "contain" }} /> : <b>{b.name}</b>}
                </div>
                <div style={{ padding: 14, fontSize: 13 }}><b>Emails and forms</b><br /><span className="monarch-muted">{b.name}{b.supportEmail ? ` · ${b.supportEmail}` : ""}{` · Powered by ${PLATFORM.name}`}</span></div>
              </div>
              <div style={{ borderRadius: 12, overflow: "hidden", border: "1px solid #e7e5de", background: b.sidebar, color: "#fff", padding: 14 }}>
                {b.whiteLabelAdmin ? (b.logoUrl ? <img src={b.logoUrl} alt="" style={{ maxHeight: 44, maxWidth: 180, objectFit: "contain" }} /> : <b>{b.name}</b>) : <b>{PLATFORM.name}</b>}
                <div style={{ fontSize: 12, opacity: 0.8, marginTop: 8 }}>{b.whiteLabelAdmin ? "Your sign-in page and admin use your brand." : `Your admin shows ${PLATFORM.name}, with your name as the account.`}</div>
              </div>
            </div>
            {row && <p className="monarch-muted">Last saved {when(row.updated_at)}.</p>}
          </section>

          <form action={saveBrandingAction} className="monarch-panel monarch-form" style={{ padding: 20 }} encType="multipart/form-data">
            <h2 className="is-wide">Your brand</h2>
            <label>Name your clients see<input name="name" required minLength={2} maxLength={80} defaultValue={b.name} /></label>
            <label>Tagline (optional)<input name="tagline" maxLength={120} defaultValue={b.tagline ?? ""} placeholder="A short line under your logo" /></label>
            <label>Support email (optional)<input name="support_email" type="email" maxLength={254} defaultValue={b.supportEmail ?? ""} placeholder="support@yourfirm.com" />
              <small className="monarch-muted">Shown at the bottom of emails as the address to write to.</small>
            </label>
            <label>Your sign-in address (optional)<input name="app_host" maxLength={253} defaultValue={b.appHost ?? ""} placeholder="app.yourfirm.com" />
              <small className="monarch-muted">When your team signs in at this address, the page shows your brand. The address must also be connected to your account by support.</small>
            </label>
            <label>Logo (PNG, JPG or WebP, up to 4 MB)
              <input type="file" name="logo_file" accept="image/png,image/jpeg,image/webp" />
              {b.logoUrl && <span className="monarch-muted">Current: <a href={b.logoUrl} target="_blank" rel="noreferrer">view</a> <label className="monarch-check" style={{ display: "inline-flex" }}><input type="checkbox" name="logo_remove" /> Remove it</label></span>}
              <input type="hidden" name="logo_url" value={row?.logo_url ?? ""} />
              <small className="monarch-muted">Wide logos work best. Used in emails, on forms and documents, and on your sign-in page.</small>
            </label>
            <label>Small logo or icon (square works best)
              <input type="file" name="mark_file" accept="image/png,image/jpeg,image/webp" />
              {row?.mark_url && <span className="monarch-muted">Current: <a href={row.mark_url} target="_blank" rel="noreferrer">view</a> <label className="monarch-check" style={{ display: "inline-flex" }}><input type="checkbox" name="mark_remove" /> Remove it</label></span>}
              <input type="hidden" name="mark_url" value={row?.mark_url ?? ""} />
              <small className="monarch-muted">Used where space is tight: the top bar and the collapsed menu.</small>
            </label>
            <ColorField name="primary_color" label="Main colour (buttons, email header)" value={row?.primary_color ?? null} />
            <ColorField name="accent_color" label="Accent colour" value={row?.accent_color ?? null} />
            <ColorField name="sidebar_color" label="Menu and header colour (dark works best)" value={row?.sidebar_color ?? null} />

            <h2 className="is-wide">Who sees what</h2>
            <label className="monarch-check is-wide"><input type="checkbox" name="white_label_admin" defaultChecked={b.whiteLabelAdmin} /> <span><b>White-label my admin and sign-in page.</b> My team sees my logo, name and colors instead of {PLATFORM.name}.</span></label>
            <p className="monarch-muted is-wide">Every form and email your clients see ends with &ldquo;Powered by {PLATFORM.name}&rdquo;. It is part of every plan and can&apos;t be turned off.</p>
            <div className="is-wide"><SubmitOnce className="monarch-primary" busy="Saving…">Save branding</SubmitOnce></div>
          </form>
        </>
      )}
    </>
  );
}
