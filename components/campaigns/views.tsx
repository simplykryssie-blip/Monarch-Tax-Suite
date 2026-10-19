import Link from "next/link";
import { Flash } from "@/components/admin/ui";
import { SupabaseSendersRepo } from "@/lib/automation/supabase-senders";
import { senderAddress } from "@/lib/automation/senders.ts";
import { addressFor, EXCLUSION_TEXT, LEAD_STATUSES, marketable, sanitizeFilter, textConsent, type AudienceFilter, type Exclusion } from "@/lib/campaigns/audience.ts";
import { CAMPAIGN_VARIABLES, renderEmail, renderSmsBody, smsSegments, valuesFor } from "@/lib/campaigns/compose.ts";
import type { CampaignsContext } from "@/lib/campaigns/context";
import { officeHealth, previewAudience, scheduleProblems, type Campaign, type Recipient } from "@/lib/campaigns/service.ts";
import { appOrigin } from "@/lib/admin";
import { tenantClient } from "@/lib/supabase/service";
import {
  blockEmailAction, cancelCampaignAction, consentAction, copyCampaignAction, createCampaignAction, deleteDraftAction, removeSegmentAction, resumeCampaignAction,
  saveCampaignAction, saveSegmentAction, unblockAction, useSegmentAction,
} from "@/app/campaigns-actions";

type Search = { notice?: string; error?: string; view?: string; q?: string; kind?: string };

const Hidden = ({ ctx }: { ctx: CampaignsContext }) => <input type="hidden" name="area" value={ctx.area} />;
const STATUS: Record<Campaign["status"], string> = { draft: "Draft", scheduled: "Scheduled", sending: "Sending", sent: "Sent", paused: "Paused", cancelled: "Cancelled" };
const CHANNEL = { email: "Email", sms: "Text" } as const;
const when = (iso: string | null, tz = "America/New_York") => (iso ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: tz }).format(new Date(iso)) : "—");
const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "—");
const webhookUrl = async () => `${await appOrigin()}/api/campaigns/resend-webhook`;
const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;

function Tabs({ ctx, here }: { ctx: CampaignsContext; here: "campaigns" | "contacts" }) {
  return (
    <nav className="cl-tabs" aria-label="Campaigns">
      <Link href={ctx.base} className={here === "campaigns" ? "is-on" : undefined} aria-current={here === "campaigns" ? "page" : undefined}>Campaigns</Link>
      <Link href={`${ctx.base}/contacts`} className={here === "contacts" ? "is-on" : undefined} aria-current={here === "contacts" ? "page" : undefined}>Contacts &amp; consent</Link>
    </nav>
  );
}

// ------------------------------------------------------------------ the list

export async function CampaignsHome({ ctx, sp }: { ctx: CampaignsContext; sp: Search }) {
  const [list, health, tz] = await Promise.all([ctx.deps.repo.listCampaigns(), officeHealth(ctx.deps).catch(() => null), ctx.deps.calendar().then((c) => c.timeZone).catch(() => "America/New_York")]);
  return (
    <>
      <h1 className="office-h1">Campaigns</h1>
      <Flash notice={sp.notice} error={sp.error} />
      <Tabs ctx={ctx} here="campaigns" />
      {health && health.level !== "ok" && (
        <p className="monarch-notice" role="status">
          <b>{health.level === "paused" ? "Email sending is paused." : "Email sending is slowed."}</b> {health.reason} {health.level === "paused" ? "Clean up your list (remove addresses that bounce), then it can resume as the numbers recover." : "It speeds back up as the numbers recover."}
        </p>
      )}
      <section className="monarch-panel" style={{ padding: 20 }}>
        <h2 style={{ marginTop: 0 }}>New campaign</h2>
        <form action={createCampaignAction} className="monarch-inline-form" style={{ flexWrap: "wrap" }}>
          <Hidden ctx={ctx} />
          <input name="name" required maxLength={120} placeholder="For example, Spring tax-season reminder" aria-label="Campaign name" />
          <select name="channel" aria-label="Channel" defaultValue="email"><option value="email">Email</option><option value="sms">Text message</option></select>
          <button className="monarch-primary">Start a draft</button>
        </form>
        <p className="monarch-muted" style={{ marginBottom: 0 }}>Campaigns only go to people who may be contacted: your clients, people who booked with you, people who signed up on a form, and anyone you mark on the Contacts page. Everyone gets an unsubscribe link or a STOP reply.</p>
      </section>
      <section className="monarch-panel">
        <div className="monarch-panel-head"><div><h2>Your campaigns</h2></div></div>
        <div className="monarch-table-wrap"><table>
          <thead><tr><th>CAMPAIGN</th><th>TYPE</th><th>STATUS</th><th>PEOPLE</th><th>WHEN</th><th></th></tr></thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={6} className="monarch-empty">No campaigns yet. Start a draft above.</td></tr>}
            {list.map((c) => (
              <tr key={c.id}>
                <td><b>{c.name}</b></td>
                <td>{CHANNEL[c.channel]}</td>
                <td>{STATUS[c.status]}{c.status === "paused" && c.paused_reason ? <span className="monarch-muted"> · {c.paused_reason}</span> : null}</td>
                <td>{c.status === "draft" ? "—" : c.recipient_count}</td>
                <td>{c.status === "scheduled" ? when(c.send_at, tz) : c.finished_at ? when(c.finished_at, tz) : c.started_at ? when(c.started_at, tz) : when(c.created_at, tz)}</td>
                <td style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Link className="monarch-secondary efin-small" href={`${ctx.base}/${c.id}`}>{c.status === "draft" ? "Edit" : "View"}</Link>
                  <form action={copyCampaignAction}><Hidden ctx={ctx} /><input type="hidden" name="campaign_id" value={c.id} /><button className="monarch-link">Copy</button></form>
                  {c.status === "draft" && <form action={deleteDraftAction}><Hidden ctx={ctx} /><input type="hidden" name="campaign_id" value={c.id} /><button className="monarch-link is-danger">Delete</button></form>}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </section>
    </>
  );
}

// ------------------------------------------------------------------ the editor

async function senderOptions(ctx: CampaignsContext) {
  const repo = new SupabaseSendersRepo(tenantClient(ctx.tenantId));
  const [senders, domains] = await Promise.all([repo.listSenders().catch(() => []), repo.listDomains().catch(() => [])]);
  const ok = new Map(domains.filter((d) => d.status === "verified").map((d) => [d.id, d]));
  return senders.filter((s) => !s.archived_at && ok.has(s.domain_id)).map((s) => ({ id: s.id, label: `${s.from_name} <${senderAddress(s, ok.get(s.domain_id)!)}>`, isDefault: s.is_default }));
}

function EmailPreview({ html, phone, href }: { html: string; phone: boolean; href: (v: string) => string }) {
  return (
    <>
      <p style={{ display: "flex", gap: 12 }}>
        <Link href={href("desktop")} className={phone ? "monarch-link" : "monarch-secondary efin-small"}>Computer</Link>
        <Link href={href("phone")} className={phone ? "monarch-secondary efin-small" : "monarch-link"}>Phone</Link>
      </p>
      <div className="cp-frame" data-phone={phone ? "1" : "0"}>
        <iframe title="Email preview" sandbox="" srcDoc={html} />
      </div>
    </>
  );
}

export async function CampaignEditor({ ctx, c, sp }: { ctx: CampaignsContext; c: Campaign; sp: Search }) {
  const filter: AudienceFilter = sanitizeFilter(c.audience);
  const [office, contacts, segments, senders, audience, problems, tz] = await Promise.all([
    ctx.deps.office(), ctx.deps.repo.listContacts(), ctx.deps.repo.listSegments(), c.channel === "email" ? senderOptions(ctx) : Promise.resolve([]),
    previewAudience(ctx.deps, c.channel, c.audience), scheduleProblems(ctx.deps, c).catch((e) => [e instanceof Error ? e.message : "Couldn't check this campaign."]),
    ctx.deps.calendar().then((x) => x.timeZone).catch(() => "America/New_York"),
  ]);
  const sample = valuesFor({ name: "Jane Sample" }, office);
  const phone = sp.view === "phone";
  let preview: React.ReactNode = null;
  let segmentsUsed = 0;
  if (c.channel === "email") {
    let rendered: { subject: string; html: string } | null = null;
    let renderError: string | null = null;
    try {
      rendered = renderEmail({ subject: c.subject ?? "", body: c.body || "Your message will appear here.", values: sample, brand: office.brand, address: office.address ?? "(your mailing address)", unsubscribeUrl: "#", trackLink: null, openPixel: null, previewBanner: true });
    } catch (e) {
      renderError = e instanceof Error ? e.message : "The preview couldn't be made.";
    }
    preview = rendered
      ? (<><p><b>Subject:</b> {rendered.subject || <span className="monarch-muted">(no subject yet)</span>}</p><EmailPreview html={rendered.html} phone={phone} href={(v) => `${ctx.base}/${c.id}?view=${v}`} /></>)
      : <p className="monarch-notice">{renderError}</p>;
  } else {
    const body = renderSmsBody(c.body || "Your message will appear here.", sample);
    segmentsUsed = smsSegments(body).segments;
    preview = (<><div className="cp-sms" aria-label="Text message preview">{body}</div><p className="monarch-muted">{body.length} characters · {segmentsUsed} message {segmentsUsed === 1 ? "part" : "parts"} each. The office name and &ldquo;Reply STOP to opt out.&rdquo; are added for you.</p></>);
  }
  const manual = filter.mode === "manual";
  const picked = new Set(filter.picked.map((p) => `${p.kind}:${p.id}`));
  const pickList = contacts.slice().sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")).slice(0, 500);
  const excluded = Object.entries(audience.excluded).filter(([, n]) => n > 0) as [Exclusion, number][];
  return (
    <>
      <p><Link href={ctx.base}>← All campaigns</Link></p>
      <h1 className="office-h1">{c.name}</h1>
      <Flash notice={sp.notice} error={sp.error} />
      <form action={saveCampaignAction} className="monarch-panel monarch-form" style={{ padding: 20 }}>
        <Hidden ctx={ctx} />
        <input type="hidden" name="campaign_id" value={c.id} />
        <input type="hidden" name="channel" value={c.channel} />
        <h2 className="is-wide" style={{ margin: 0 }}>1. Message <span className="monarch-muted" style={{ fontWeight: 400 }}>· {CHANNEL[c.channel]}</span></h2>
        <label>Campaign name<input name="name" defaultValue={c.name} required maxLength={120} /></label>
        {c.channel === "email" && (
          <>
            <label>Subject
              <input name="subject" defaultValue={c.subject ?? ""} maxLength={200} placeholder="Say plainly what the email is about" />
              <small className="monarch-muted">Be honest: the subject must match what is inside. No fake &ldquo;Re:&rdquo; or &ldquo;urgent&rdquo; tricks.</small>
            </label>
            <label>Send from
              <select name="sender_id" defaultValue={c.sender_id ?? ""}>
                <option value="">{senders.some((s) => s.isDefault) ? "Your default sending address" : "Default sending address"}</option>
                {senders.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
              {senders.length === 0 && <small className="monarch-muted">Connect your own domain and add a sending address in Settings → Email sending first.</small>}
            </label>
          </>
        )}
        <label className="is-wide">Message
          <textarea name="body" defaultValue={c.body} rows={c.channel === "sms" ? 5 : 12} maxLength={20000} />
          <small className="monarch-muted">
            Merge fields: {Object.entries(CAMPAIGN_VARIABLES).map(([k, d]) => <span key={k} title={d}><code>{`{{${k}}}`}</code> </span>)}
            {c.channel === "email" ? " · Plain text with **bold**, *italic*, [link text](https://example.com) and lists. A footer with your mailing address and an unsubscribe link is added to every email." : " · The office name goes first and “Reply STOP to opt out.” goes last, added for you."}
          </small>
        </label>

        <h2 className="is-wide" style={{ margin: "12px 0 0" }}>2. Who gets it</h2>
        <fieldset className="is-wide cp-box">
          <legend>Choose people</legend>
          <label className="cp-radio"><input type="radio" name="mode" value="filter" defaultChecked={!manual} /> By group (tags, type, status)</label>
          <label className="cp-radio"><input type="radio" name="mode" value="manual" defaultChecked={manual} /> Pick people by hand</label>
          <div className="cp-grid">
            <div><b>Include</b>
              <label className="cp-radio"><input type="checkbox" name="kinds" value="client" defaultChecked={filter.kinds.includes("client")} /> Clients</label>
              <label className="cp-radio"><input type="checkbox" name="kinds" value="lead" defaultChecked={filter.kinds.includes("lead")} /> Leads</label>
            </div>
            <div><b>Lead status</b>
              {Object.entries(LEAD_STATUSES.reduce<Record<string, string>>((m, s) => ({ ...m, [s]: s[0].toUpperCase() + s.slice(1) }), {})).map(([k, label]) => (
                <label key={k} className="cp-radio"><input type="checkbox" name="leadStatus" value={k} defaultChecked={filter.leadStatus.includes(k)} /> {label}</label>
              ))}
              <small className="monarch-muted">None ticked means any.</small>
            </div>
            <div>
              <label>Has any of these tags<input name="tagsAny" defaultValue={filter.tagsAny.join(", ")} placeholder="e.g. 1040, referral" /></label>
              <label>Does not have these tags<input name="tagsNone" defaultValue={filter.tagsNone.join(", ")} placeholder="e.g. do-not-market" /></label>
            </div>
          </div>
          <details open={manual}>
            <summary>Hand-pick people ({people(filter.picked.length)} picked{contacts.length > pickList.length ? `; showing the first ${pickList.length} of ${contacts.length}` : ""})</summary>
            <div className="cp-picklist">
              {pickList.map((p) => (
                <label key={`${p.kind}:${p.id}`} className="cp-radio"><input type="checkbox" name="picked" value={`${p.kind}:${p.id}`} defaultChecked={picked.has(`${p.kind}:${p.id}`)} /> {p.name ?? "(no name)"} <span className="monarch-muted">· {p.kind === "client" ? "client" : "lead"} · {c.channel === "email" ? p.email ?? "no email" : p.phone ?? "no phone"}</span></label>
              ))}
              {pickList.length === 0 && <p className="monarch-muted">No clients or leads yet.</p>}
            </div>
          </details>
          <label>Save this audience for later<span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><input name="segment_name" maxLength={80} placeholder="e.g. Past-year 1040 clients" /><button formAction={saveSegmentAction} className="monarch-secondary">Save audience</button></span></label>
        </fieldset>

        <h2 className="is-wide" style={{ margin: "12px 0 0" }}>3. When</h2>
        <fieldset className="is-wide cp-box">
          <label className="cp-radio"><input type="radio" name="when" value="now" defaultChecked /> Send as soon as it&apos;s scheduled</label>
          <label className="cp-radio"><input type="radio" name="when" value="later" /> Send at <input type="datetime-local" name="send_at" aria-label={`Date and time (${tz})`} /> <span className="monarch-muted">({tz.replace("_", " ")})</span></label>
          <label className="cp-radio"><input type="checkbox" name="respect_hours" defaultChecked={c.respect_hours} /> Only send while my office is open <span className="monarch-muted">(uses your business hours and closures; the rest waits for the next opening)</span></label>
        </fieldset>
        <div className="is-wide" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button name="then" value="save" className="monarch-secondary">Save draft</button>
          <button name="then" value="schedule" className="monarch-primary">Save and schedule</button>
        </div>
      </form>

      <section className="monarch-panel" style={{ padding: 20 }}>
        <h2 style={{ marginTop: 0 }}>Who will get it (as of the saved draft)</h2>
        <p><b>{people(audience.eligible.length)}</b> {audience.eligible.length === 1 ? "is" : "are"} in this audience right now.{audience.picked > 0 ? ` ${people(audience.picked)} matched your choices.` : " Nobody matches your choices yet."} The final list is worked out again when sending starts, so anyone who unsubscribes before then is left out.</p>
        {excluded.length > 0 && (
          <>
            <p className="monarch-muted" style={{ marginBottom: 4 }}>Left out, and why:</p>
            <ul style={{ marginTop: 0 }}>{excluded.map(([k, n]) => <li key={k}>{people(n)}: {EXCLUSION_TEXT[k]}</li>)}</ul>
            <p className="monarch-muted">Add consent on the <Link href={`${ctx.base}/contacts`}>Contacts &amp; consent</Link> page.</p>
          </>
        )}
        {audience.eligible.length > 0 && <p className="monarch-muted">For example: {audience.eligible.slice(0, 5).map((e) => e.name ?? e.address).join(", ")}{audience.eligible.length > 5 ? `, and ${audience.eligible.length - 5} more` : ""}.</p>}
        {problems.length > 0 && (<div className="monarch-notice" role="status"><b>Before you can schedule:</b><ul style={{ margin: "4px 0 0" }}>{problems.map((p) => <li key={p}>{p}</li>)}</ul></div>)}
      </section>

      <section className="monarch-panel" style={{ padding: 20 }}>
        <h2 style={{ marginTop: 0 }}>Preview</h2>
        <p className="monarch-muted">Shown with sample data (&ldquo;Jane Sample&rdquo;). Save the draft to refresh it after editing.</p>
        {preview}
      </section>

      {segments.length > 0 && (
        <section className="monarch-panel" style={{ padding: 20 }}>
          <h2 style={{ marginTop: 0 }}>Saved audiences</h2>
          <ul className="cp-list">
            {segments.map((s) => (
              <li key={s.id}>
                <b>{s.name}</b>
                <form action={useSegmentAction}><Hidden ctx={ctx} /><input type="hidden" name="campaign_id" value={c.id} /><input type="hidden" name="segment_id" value={s.id} /><button className="monarch-secondary efin-small">Use for this campaign</button></form>
                <form action={removeSegmentAction}><Hidden ctx={ctx} /><input type="hidden" name="campaign_id" value={c.id} /><input type="hidden" name="segment_id" value={s.id} /><button className="monarch-link is-danger">Remove</button></form>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

// ------------------------------------------------------------------ results

const RECIPIENT_STATUS: Record<Recipient["status"], string> = { queued: "Waiting", sending: "Sending", sent: "Sent", delivered: "Delivered", bounced: "Bounced", complained: "Marked as spam", failed: "Failed", skipped: "Skipped" };

export async function CampaignResults({ ctx, c, sp }: { ctx: CampaignsContext; c: Campaign; sp: Search }) {
  const [counts, links, rows, tz] = await Promise.all([
    ctx.deps.repo.counts(c.id), ctx.deps.repo.listLinks(c.id), ctx.deps.repo.listRecipients(c.id, 200), ctx.deps.calendar().then((x) => x.timeZone).catch(() => "America/New_York"),
  ]);
  const reached = counts.sent + counts.delivered + counts.bounced + counts.complained;
  const email = c.channel === "email";
  const cards: [string, string, string?][] = [
    ["Sent", String(reached), `of ${c.recipient_count}`],
    ["Delivered", String(counts.delivered), pct(counts.delivered, reached)],
    ...(email ? ([["Opened", String(counts.opened), pct(counts.opened, reached)], ["Clicked", String(counts.clicked), pct(counts.clicked, reached)]] as [string, string, string?][]) : []),
    ["Bounced", String(counts.bounced), pct(counts.bounced, reached)],
    ...(email ? ([["Marked as spam", String(counts.complained), pct(counts.complained, reached)]] as [string, string, string?][]) : []),
    ["Unsubscribed", String(counts.unsubscribed), pct(counts.unsubscribed, reached)],
    ["Failed", String(counts.failed)],
    ["Skipped", String(counts.skipped), "left out at send time"],
    ["Waiting", String(counts.queued + counts.sending)],
  ];
  return (
    <>
      <p><Link href={ctx.base}>← All campaigns</Link></p>
      <h1 className="office-h1">{c.name}</h1>
      <Flash notice={sp.notice} error={sp.error} />
      <section className="monarch-panel" style={{ padding: 20 }}>
        <div className="se-status">
          <b>{STATUS[c.status]}</b><span className="monarch-muted">{CHANNEL[c.channel]}{c.status === "scheduled" ? ` · starts ${when(c.send_at, tz)}` : c.started_at ? ` · started ${when(c.started_at, tz)}` : ""}{c.finished_at ? ` · finished ${when(c.finished_at, tz)}` : ""}</span>
          {(c.status === "scheduled" || c.status === "sending" || c.status === "paused") && <form action={cancelCampaignAction}><Hidden ctx={ctx} /><input type="hidden" name="campaign_id" value={c.id} /><button className="monarch-secondary">Cancel campaign</button></form>}
          {c.status === "paused" && <form action={resumeCampaignAction}><Hidden ctx={ctx} /><input type="hidden" name="campaign_id" value={c.id} /><button className="monarch-primary">Resume</button></form>}
          <form action={copyCampaignAction}><Hidden ctx={ctx} /><input type="hidden" name="campaign_id" value={c.id} /><button className="monarch-secondary">Copy as new draft</button></form>
        </div>
        {c.status === "paused" && c.paused_reason && <p className="monarch-notice" role="status" style={{ marginBottom: 0 }}>{c.paused_reason}</p>}
        {c.status === "scheduled" && <p className="monarch-muted" style={{ marginBottom: 0 }}>The list of people is worked out when sending starts.</p>}
      </section>
      {c.status !== "scheduled" && (
        <section className="cp-cards" aria-label="Results">
          {cards.map(([label, value, note]) => <div key={label} className="monarch-panel cp-card"><span className="monarch-muted">{label}</span><b>{value}</b>{note && <small className="monarch-muted">{note}</small>}</div>)}
        </section>
      )}
      {email && links.length > 0 && (
        <section className="monarch-panel">
          <div className="monarch-panel-head"><div><h2>Links clicked</h2></div></div>
          <div className="monarch-table-wrap"><table><thead><tr><th>LINK</th><th>CLICKS</th></tr></thead><tbody>{links.map((l) => <tr key={l.position}><td style={{ wordBreak: "break-all" }}>{l.url}</td><td>{l.click_count}</td></tr>)}</tbody></table></div>
        </section>
      )}
      {rows.length > 0 && (
        <section className="monarch-panel">
          <div className="monarch-panel-head"><div><h2>People</h2><p>{rows.length < c.recipient_count ? `The first ${rows.length} of ${c.recipient_count}.` : `${c.recipient_count} in all.`} Email addresses are shown only to you.</p></div></div>
          <div className="monarch-table-wrap"><table>
            <thead><tr><th>NAME</th><th>{email ? "EMAIL" : "NUMBER"}</th><th>STATUS</th>{email && <th>OPENED</th>}{email && <th>CLICKED</th>}<th>NOTE</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.name ?? "—"}</td><td>{r.address}</td><td>{RECIPIENT_STATUS[r.status]}</td>
                  {email && <td>{r.open_count ? `${r.open_count}×` : "—"}</td>}{email && <td>{r.click_count ? `${r.click_count}×` : "—"}</td>}
                  <td className="monarch-muted">{r.unsubscribed_at ? "Unsubscribed" : r.skip_reason ?? r.error ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </section>
      )}
      {email && <p className="monarch-muted">Opens are counted when a mail app loads the small picture in the email, so they are an estimate: some apps load it automatically and some block it.</p>}
    </>
  );
}

// ------------------------------------------------------------------ contacts and consent

export async function ContactsView({ ctx, sp }: { ctx: CampaignsContext; sp: Search }) {
  const [contacts, consents, emailBlocked, smsBlocked, suppressions, segments] = await Promise.all([
    ctx.deps.repo.listContacts(), ctx.deps.repo.listConsents(), ctx.deps.repo.suppressed("email"), ctx.deps.repo.suppressed("sms"), ctx.deps.repo.listSuppressions(), ctx.deps.repo.listSegments(),
  ]);
  const byEmail = new Map(consents.map((r) => [r.email, r]));
  const q = (sp.q ?? "").trim().toLowerCase();
  const kind = sp.kind === "lead" || sp.kind === "client" ? sp.kind : "";
  const shown = contacts
    .filter((c) => (!kind || c.kind === kind) && (!q || `${c.name ?? ""} ${c.email ?? ""} ${c.tags.join(" ")}`.toLowerCase().includes(q)))
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  const page = shown.slice(0, 300);
  const state = (c: (typeof contacts)[number]) => {
    const email = (c.email ?? "").trim().toLowerCase();
    const consent = email ? byEmail.get(email) : undefined;
    const addr = addressFor(c, "email");
    if (!addr) return { label: "No email address", ok: false, text: false };
    if (emailBlocked.has(addr)) return { label: "Unsubscribed or blocked", ok: false, text: false };
    if (c.archived) return { label: "Archived", ok: false, text: false };
    const ok = marketable(c, consent);
    const phone = addressFor(c, "sms");
    return { label: ok ? (c.kind === "client" ? "Client" : consent ? `Consent (${consent.basis})` : "Booked") : consent?.revoked ? "Consent removed" : "No consent", ok, text: ok && textConsent(c, consent) && phone !== null && !smsBlocked.has(phone) };
  };
  return (
    <>
      <h1 className="office-h1">Campaigns</h1>
      <Flash notice={sp.notice} error={sp.error} />
      <Tabs ctx={ctx} here="contacts" />
      <section className="monarch-panel" style={{ padding: 20 }}>
        <h2 style={{ marginTop: 0 }}>Who can be sent campaigns</h2>
        <p style={{ marginBottom: 4 }}>Clients, people who booked an appointment, and people who filled in a form that adds them to Leads can be sent campaigns automatically. Anyone else needs your OK: tick them below and mark them. Text messages also need the person to have agreed to texts.</p>
        <p className="monarch-muted" style={{ marginBottom: 0 }}>Marking someone says that you have their permission to send them marketing. You are responsible for that, and for following the laws that apply to you. Importing a list? Use <Link href="/leads/import">Leads → Import</Link> and tick &ldquo;Mark all as marketable&rdquo; only if everyone in the file agreed.</p>
      </section>
      <section className="monarch-panel">
        <div className="monarch-panel-head"><div><h2>People</h2><p>{people(shown.length)}{shown.length > page.length ? `; showing the first ${page.length}. Search to narrow it` : ""}.</p></div></div>
        <form method="get" className="monarch-inline-form" style={{ flexWrap: "wrap", padding: "0 20px" }}>
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Search name, email or tag" aria-label="Search" />
          <select name="kind" defaultValue={kind} aria-label="Type"><option value="">Clients and leads</option><option value="client">Clients</option><option value="lead">Leads</option></select>
          <button className="monarch-secondary">Search</button>
        </form>
        <form action={consentAction}>
          <Hidden ctx={ctx} />
          <div className="cp-bulk">
            <select name="op" aria-label="What to do with the people ticked" defaultValue="">
              <option value="" disabled>With the people I tick…</option>
              <option value="marketable">Mark as OK to send campaigns</option>
              <option value="marketable_sms">Mark as OK, and they agreed to texts</option>
              <option value="revoke">Take away marketing consent</option>
              <option value="tag_add">Add a tag</option>
              <option value="tag_remove">Remove a tag</option>
            </select>
            <input name="tag" placeholder="Tag (for add or remove)" maxLength={40} aria-label="Tag" />
            <button className="monarch-primary">Apply</button>
          </div>
          <div className="monarch-table-wrap"><table>
            <thead><tr><th></th><th>NAME</th><th>TYPE</th><th>EMAIL</th><th>TAGS</th><th>CAMPAIGNS</th><th>TEXTS</th></tr></thead>
            <tbody>
              {page.length === 0 && <tr><td colSpan={7} className="monarch-empty">Nobody matches.</td></tr>}
              {page.map((c) => {
                const s = state(c);
                return (
                  <tr key={`${c.kind}:${c.id}`}>
                    <td><input type="checkbox" name="pick" value={`${c.kind}:${c.id}`} aria-label={`Select ${c.name ?? c.email ?? "person"}`} /></td>
                    <td>{c.name ?? "—"}</td><td>{c.kind === "client" ? "Client" : "Lead"}</td><td>{c.email ?? "—"}</td>
                    <td>{c.tags.length ? c.tags.join(", ") : "—"}</td>
                    <td className={s.ok ? undefined : "monarch-muted"}>{s.ok ? "✓ " : "✗ "}{s.label}</td>
                    <td>{s.text ? "✓ Agreed" : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        </form>
      </section>
      <section className="monarch-panel" style={{ padding: 20 }}>
        <h2 style={{ marginTop: 0 }}>Blocked from campaigns</h2>
        <p className="monarch-muted">Unsubscribes, STOP replies, bounces and spam complaints are blocked automatically and can&apos;t be undone here. You can also block an address yourself.</p>
        <form action={blockEmailAction} className="monarch-inline-form" style={{ flexWrap: "wrap" }}><Hidden ctx={ctx} /><input name="email" type="email" required placeholder="name@example.com" aria-label="Email to block" /><button className="monarch-secondary">Block this address</button></form>
        {suppressions.length > 0 && (
          <div className="monarch-table-wrap"><table>
            <thead><tr><th>ADDRESS</th><th>TYPE</th><th>REASON</th><th>WHEN</th><th></th></tr></thead>
            <tbody>
              {suppressions.slice(0, 200).map((s) => (
                <tr key={s.id}>
                  <td>{s.address}</td><td>{s.channel === "sms" ? "Text" : "Email"}</td>
                  <td>{{ unsubscribed: "Unsubscribed", stop: "Replied STOP", bounced: "Bounced", complaint: "Marked as spam", manual: "Blocked by you" }[s.reason]}</td>
                  <td>{when(s.created_at)}</td>
                  <td>{s.reason === "manual" && <form action={unblockAction}><Hidden ctx={ctx} /><input type="hidden" name="channel" value={s.channel} /><input type="hidden" name="address" value={s.address} /><button className="monarch-link">Unblock</button></form>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </section>
      {ctx.area === "admin" && (
        <section className="monarch-panel" style={{ padding: 20 }}>
          <h2 style={{ marginTop: 0 }}>Provider setup (one time, for the whole platform)</h2>
          <p className="monarch-muted">Open and bounce reports come from Resend, registered once for the platform.</p>
          <ul>
            <li>Resend → Webhooks: add <code>{await webhookUrl()}</code> for the events <i>email.delivered</i>, <i>email.bounced</i> and <i>email.complained</i>, then set its signing secret as <code>RESEND_WEBHOOK_SECRET</code> in Vercel.</li>
            <li>Texts: nothing to do. Each office&apos;s number is pointed at the platform automatically when it&apos;s bought, and the daily check covers older numbers.</li>
          </ul>
        </section>
      )}
      {segments.length > 0 && (
        <section className="monarch-panel" style={{ padding: 20 }}>
          <h2 style={{ marginTop: 0 }}>Saved audiences</h2>
          <ul className="cp-list">{segments.map((s) => <li key={s.id}><b>{s.name}</b><form action={removeSegmentAction}><Hidden ctx={ctx} /><input type="hidden" name="campaign_id" value="" /><input type="hidden" name="segment_id" value={s.id} /><button className="monarch-link is-danger">Remove</button></form></li>)}</ul>
        </section>
      )}
    </>
  );
}
