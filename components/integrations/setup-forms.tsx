"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { activateAction, completeOnboardingAction, saveProfileAction, connectHighLevelAction, disconnectAction, finishInstallAction, lookupAction, saveSettingsAction, setWebhookAction, testAction, type SetupState } from "@/app/integrations/actions";

// Three plain steps: activate, connect, test and turn on. Every form sends the license key typed
// on this page; nothing is remembered after the page closes. Webhook and signing-secret details
// live only under "Advanced" in step 2.
type Section = "profile" | "complete" | "lookup" | "activate" | "hook" | "test" | "save" | "ghl" | "finish";

export function SetupForms({ highlevelAvailable, pending, linked = false }: { highlevelAvailable: boolean; linked?: boolean; pending?: { locationId: string; locationName: string | null } | null }) {
  const [key, setKey] = useState("");
  const [domain, setDomain] = useState("");
  const [state, setState] = useState<SetupState>({});
  // The result of an action is shown right beside the button that was pressed, so it can't be missed.
  const [feedback, setFeedback] = useState<{ section: Section; ok: boolean; message: string } | null>(null);
  const topRef = useRef<HTMLParagraphElement>(null);
  const wrap = (section: Section, fn: (p: SetupState, f: FormData) => Promise<SetupState>) => async (prev: SetupState, f: FormData) => {
    setFeedback(null);
    let next: SetupState;
    try {
      next = await fn(prev, f);
    } catch {
      next = { ok: false, message: "Something went wrong on our side. Please try again in a moment." };
    }
    if (section === "finish" && next.ok) setFinished(true);
    setFeedback(next.message ? { section, ok: Boolean(next.ok), message: next.message } : null);
    setState((s) => ({ ...next, view: next.view ?? s.view, signingSecret: next.signingSecret }));
    return next;
  };
  const savedAt = useRef(0);
  useEffect(() => {
    // After a successful save, bring the overall status into view.
    if (feedback?.section === "save" && feedback.ok && Date.now() - savedAt.current > 500) {
      savedAt.current = Date.now();
      topRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [feedback]);
  const note = (section: Section) => (feedback?.section === section ? <p className={`monarch-alert${feedback.ok ? " is-ok" : " is-error"}`} role={feedback.ok ? "status" : "alert"}>{feedback.ok ? "✓ " : "✗ "}{feedback.message}</p> : null);
  const [, lookup, looking] = useActionState(wrap("lookup", lookupAction), {});
  const [, activate, activating] = useActionState(wrap("activate", activateAction), {});
  const [, hook, hooking] = useActionState(wrap("hook", setWebhookAction), {});
  const [, test, testing] = useActionState(wrap("test", testAction), {});
  const [, disc, disconnecting] = useActionState(wrap("test", disconnectAction), {});
  const [, save, saving] = useActionState(wrap("save", saveSettingsAction), {});
  const [, ghl, connecting] = useActionState(wrap("ghl", connectHighLevelAction), {});
  const [, finishInstall, finishing] = useActionState(wrap("finish", finishInstallAction), {});
  const [finished, setFinished] = useState(false);
  const [, saveProfile, savingProfile] = useActionState(wrap("profile", saveProfileAction), {});
  const [, complete, completing] = useActionState(wrap("complete", completeOnboardingAction), {});
  const [copied, setCopied] = useState(false);
  // Arriving from the emailed setup link: the server already knows the license, so load it without a key.
  useEffect(() => {
    if (linked) startTransition(() => lookup(new FormData()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linked]);
  const v = state.view;
  const status = v?.status_info;
  const hidden = <input type="hidden" name="license_key" value={key} />;
  const activated = Boolean(v && v.domains.length);

  return (
    <div className="intg-wizard">
      {linked && !v && !feedback && <p className="monarch-muted">Loading your license…</p>}
      <form action={lookup} className="intg-step" hidden={linked && Boolean(v)}>
        <h2>Your license</h2>
        <p className="monarch-muted">Enter the license key from your purchase. It stays in this form only, and never needs to be shared with anyone at Monarch.</p>
        <div className="intg-row">
          <label>License key<input name="license_key" type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} placeholder="MTS-XXXXX-XXXXX-XXXXX-XXXXX" required={!linked} /></label>
          <button className="monarch-primary" disabled={looking}>{looking ? "Checking…" : v ? "Refresh" : "Continue"}</button>
        </div>
      </form>
      {note("lookup")}
      {pending && !finished && (
        <form action={finishInstall} className="intg-step">
          {hidden}
          <h2>Finish connecting GoHighLevel</h2>
          <p>GoHighLevel approved access for <b>{pending.locationName ?? "your sub-account"}</b> <span className="monarch-muted">(ID {pending.locationId})</span>.</p>
          <p className="monarch-muted">Enter your license key above, then confirm. Only continue if this is your own GoHighLevel account. This approval expires in about 10 minutes.</p>
          <button className="monarch-primary" disabled={finishing || (!key && !linked)}>{finishing ? "Connecting…" : `Connect ${pending.locationName ?? "this account"} to my license`}</button>
          {note("finish")}
        </form>
      )}

      {v && status && (
        <>
          <p ref={topRef} className="intg-status" data-state={status.key}><b>{status.label}</b> {status.detail}</p>

          <section className="intg-step">
            <h2><span className="intg-num">1</span> Your details {v.onboarding.steps[0].done && <span className="intg-done">Done</span>}</h2>
            <p className="monarch-muted">Confirm who you are. We filled in what we already know; correct anything that is wrong.</p>
            <form action={saveProfile} className="monarch-form">
              {hidden}
              <label>Your full name<input name="contact_name" required maxLength={120} defaultValue={v.onboarding.profile.contact_name} autoComplete="name" /></label>
              <label>Business name<input name="business_name" required maxLength={120} defaultValue={v.onboarding.profile.business_name} autoComplete="organization" /></label>
              <label>Business email<input name="business_email" type="email" required maxLength={254} defaultValue={v.onboarding.profile.business_email} autoComplete="email" /></label>
              <label>Business phone (optional)<input name="phone" type="tel" maxLength={40} defaultValue={v.onboarding.profile.phone} autoComplete="tel" /></label>
              <label className="is-wide">GoHighLevel account or sub-account name, if you know it (optional)<input name="ghl_account" maxLength={120} defaultValue={v.onboarding.profile.ghl_account} /></label>
              <div className="is-wide"><button className="monarch-primary" disabled={savingProfile}>{savingProfile ? "Saving…" : "Save details"}</button>{note("profile")}</div>
            </form>
          </section>

          <section className="intg-step">
            <h2><span className="intg-num">2</span> Activate your calculator {activated && <span className="intg-done">Done</span>}</h2>
            {activated ? (
              <>
                <p>Your calculator is activated for <b>{v.domains.join(", ")}</b> (and the www version).</p>
                {note("activate")}
              </>
            ) : (
              <>
                <p className="monarch-muted">Enter your main website address, not a page. For example <code>yourbusiness.com</code>. The calculator will show only on this website.</p>
                <form action={activate} className="intg-row">
                  {hidden}
                  <label>Your website address<input name="domain" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="yourbusiness.com" required /></label>
                  <button className="monarch-secondary" disabled={activating}>Review</button>
                </form>
                {note("activate")}
                {state.pending && !state.pending.alreadyActive && (
                  <form action={activate} className="intg-confirm">
                    {hidden}<input type="hidden" name="domain" value={state.pending.domain} /><input type="hidden" name="confirm" value="yes" />
                    <p>You are about to activate the calculator for <b>{state.pending.domain}</b> and <b>{state.pending.alsoCovers}</b>. A license covers one website, so check this is right.</p>
                    <button className="monarch-primary" disabled={activating}>{activating ? "Activating…" : `Yes, activate ${state.pending.domain}`}</button>
                  </form>
                )}
              </>
            )}
          </section>

          <section className="intg-step">
            <h2><span className="intg-num">3</span> Choose where your leads should go {v.provider && status.key !== "not_connected" && <span className="intg-done">{v.label}</span>}</h2>
            {highlevelAvailable ? (
              <form action={ghl}>
                {hidden}
                <p className="monarch-muted">You sign in to GoHighLevel and choose the account that should receive leads. We never see your GoHighLevel password. We ask only to add contacts and tags and to read your account name.</p>
                <button className="monarch-primary" disabled={connecting}>{v.provider === "highlevel" ? "Reconnect GoHighLevel" : "Connect GoHighLevel"}</button>
              </form>
            ) : (
              <p className="monarch-muted">Connect GoHighLevel with a workflow link. It takes about five minutes, and the steps are below. You never share your GoHighLevel password.</p>
            )}
            {note("ghl")}
            <details className="intg-advanced" open={!highlevelAvailable || feedback?.section === "hook" || undefined}>
              <summary>{highlevelAvailable ? "Advanced: connect with a workflow link" : "Connect with a workflow link"}</summary>
              <p className="monarch-muted"><b>Do these in order, and keep your GoHighLevel workflow open the whole time.</b></p>
              <ol className="intg-steps">
                <li>In GoHighLevel, create a workflow and choose the trigger <b>Inbound Webhook</b>. Copy the link it shows. Leave that screen open.</li>
                <li>Paste the link below and press <b>Save link</b>. Saving here never changes your GoHighLevel link.</li>
                <li>Press <b>Test connection</b> in step 3. It sends one clearly fake sample lead (Test Sample, test-sample@example.com), so no real data is sent.</li>
                <li>Back in GoHighLevel, press <b>Test trigger</b> on the Inbound Webhook, then select the request that arrived as your <b>Mapping Reference</b>. GoHighLevel will not let you save the workflow until you do this.</li>
                <li>Add the actions <b>Create/Update Contact</b> (map first name, last name, email and phone from the sample) and <b>Send Email</b> if you want one. Receiving the lead does not create a contact or send an email by itself. Then <b>publish</b> the workflow.</li>
              </ol>
              <p className="monarch-muted">Saving a link here also creates a new signing secret (shown once). You don&apos;t need it for this setup.</p>
              <form action={hook} className="intg-row">
                {hidden}
                <label>Workflow link (https)<input name="webhook_url" required maxLength={2000} placeholder="https://services.leadconnectorhq.com/hooks/…" /></label>
                <button className="monarch-secondary" disabled={hooking}>{hooking ? "Saving…" : "Save link"}</button>
              </form>
              {note("hook")}
              {state.signingSecret && <p className="monarch-notice"><b>SIGNING SECRET (SHOWN ONCE)</b> <code>{state.signingSecret}</code></p>}
            </details>
          </section>

          <section className="intg-step">
            <h2><span className="intg-num">4</span> Test your connection and turn on lead capture</h2>
            {v.provider ? (
              <>
                <p>{v.label}{v.lastSuccess ? ` · last lead delivered ${new Date(v.lastSuccess).toLocaleString()}` : ""}</p>
                {v.lastError && <p className="intg-error">{v.lastError}</p>}
                <div className="monarch-inline-actions">
                  <form action={test} className="intg-row">{hidden}
                    <label>Send the test lead to my email (optional)<input name="test_email" type="email" maxLength={254} placeholder="you@yourbusiness.com" autoComplete="email" /></label>
                    <button className="monarch-primary" disabled={testing}>{testing ? "Testing…" : "Test connection"}</button>
                  </form>
                  <form action={disc}>{hidden}<button className="monarch-secondary is-danger" disabled={disconnecting}>Disconnect</button></form>
                </div>
                <p className="monarch-muted">The test lead is fake. If you enter your email, your workflow&apos;s emails will reach you. We don&apos;t keep it. Leave it blank to use a made-up address.</p>
                {note("test")}
                {!v.canEnable && !v.settings.enabled && <p className="monarch-muted">Lead capture can be turned on after the test passes.</p>}
                <form action={save} className="monarch-form">
                  {hidden}
                  <label className="monarch-check is-wide"><input type="checkbox" name="enabled" defaultChecked={v.settings.enabled} disabled={!v.canEnable && !v.settings.enabled} /> Collect leads on my calculator</label>
                  <label className="is-wide">Your business name (visitors see this when they agree to be contacted)<input name="business_name" maxLength={120} defaultValue={v.settings.business_name} /></label>
                  <details className="intg-advanced is-wide">
                    <summary>More options</summary>
                    <div className="monarch-form">
                      <label>Where the lead came from (label)<input name="lead_source" maxLength={80} defaultValue={v.settings.lead_source} /></label>
                      <label>Tags to add (separate with commas)<input name="tags" maxLength={500} defaultValue={v.settings.tags} /></label>
                      <label className="monarch-check is-wide"><input type="checkbox" name="include_summary" defaultChecked={v.settings.include_summary} /> Include the estimate summary. Visitors are told before they submit.</label>
                      <label className="monarch-check is-wide"><input type="checkbox" name="update_existing" defaultChecked={v.settings.update_existing} /> Update an existing contact if the same person submits again</label>
                    </div>
                  </details>
                  <div className="is-wide"><button className="monarch-primary" disabled={saving}>{saving ? "Saving…" : "Save"}</button>{note("save")}</div>
                </form>
              </>
            ) : (
              <p className="monarch-muted">Finish step 2 first.</p>
            )}
          </section>

          <section className="intg-step">
            <h2><span className="intg-num">5</span> Add the calculator to your website, then finish {v.onboarding.completedAt && <span className="intg-done">Complete</span>}</h2>
            {v.onboarding.embed ? (
              <>
                <p>Your calculator is authorized for <b>{v.onboarding.allowedDomains.join(", ")}</b>. Add this code to the page where it should appear (in GoHighLevel, use a <b>Custom Code / HTML</b> element):</p>
                <pre className="intg-code" tabIndex={0}>{v.onboarding.embed}</pre>
                <button type="button" className="monarch-secondary" onClick={() => { void navigator.clipboard?.writeText(v.onboarding.embed ?? "").then(() => setCopied(true)); }}>{copied ? "Copied" : "Copy code"}</button>
                <details className="intg-advanced">
                  <summary>Troubleshooting</summary>
                  <ul>
                    <li><b>The area is blank:</b> the page must be on {v.onboarding.allowedDomains[0]} (or its www version). The calculator never shows on any other address, including preview links.</li>
                    <li><b>&ldquo;Not authorized&rdquo;:</b> your website address in step 2 doesn&apos;t match the page. Contact us to change it.</li>
                    <li><b>Leads don&apos;t arrive:</b> run Test connection in step 4 and read the message it shows.</li>
                  </ul>
                </details>
              </>
            ) : (
              <p className="monarch-muted">Your calculator code appears here once your website is authorized in step 2.</p>
            )}
            <ul className="intg-checklist">
              {v.onboarding.steps.map((s) => <li key={s.key}>{s.done ? "✓" : "○"} {s.label}{s.done ? "" : ` — ${s.hint}`}</li>)}
            </ul>
            {v.onboarding.completedAt ? (
              <p className="monarch-alert is-ok">✓ Setup completed {new Date(v.onboarding.completedAt).toLocaleString()}. Your confirmation email has your installation instructions.</p>
            ) : (
              <form action={complete}>
                {hidden}
                <button className="monarch-primary" disabled={completing || v.onboarding.steps.some((s) => !s.done)}>{completing ? "Finishing…" : "Finish setup"}</button>
                {note("complete")}
              </form>
            )}
          </section>
        </>
      )}
    </div>
  );
}
