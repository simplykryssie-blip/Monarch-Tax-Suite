"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { activateAction, connectHighLevelAction, disconnectAction, finishInstallAction, lookupAction, saveSettingsAction, setWebhookAction, testAction, type SetupState } from "@/app/integrations/actions";

// Three plain steps: activate, connect, test and turn on. Every form sends the license key typed
// on this page; nothing is remembered after the page closes. Webhook and signing-secret details
// live only under "Advanced" in step 2.
type Section = "lookup" | "activate" | "hook" | "test" | "save" | "ghl" | "finish";

export function SetupForms({ highlevelAvailable, pending }: { highlevelAvailable: boolean; pending?: { locationId: string; locationName: string | null } | null }) {
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
  const v = state.view;
  const status = v?.status_info;
  const hidden = <input type="hidden" name="license_key" value={key} />;
  const activated = Boolean(v && v.domains.length);

  return (
    <div className="intg-wizard">
      <form action={lookup} className="intg-step">
        <h2>Your license</h2>
        <p className="monarch-muted">Enter the license key from your purchase. It stays in this form only, and never needs to be shared with anyone at Monarch.</p>
        <div className="intg-row">
          <label>License key<input name="license_key" type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} placeholder="MTS-XXXXX-XXXXX-XXXXX-XXXXX" required /></label>
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
          <button className="monarch-primary" disabled={finishing || !key}>{finishing ? "Connecting…" : `Connect ${pending.locationName ?? "this account"} to my license`}</button>
          {note("finish")}
        </form>
      )}

      {v && status && (
        <>
          <p ref={topRef} className="intg-status" data-state={status.key}><b>{status.label}</b> {status.detail}</p>

          <section className="intg-step">
            <h2><span className="intg-num">1</span> Activate your calculator {activated && <span className="intg-done">Done</span>}</h2>
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
            <h2><span className="intg-num">2</span> Choose where your leads should go {v.provider && status.key !== "not_connected" && <span className="intg-done">{v.label}</span>}</h2>
            {highlevelAvailable ? (
              <form action={ghl}>
                {hidden}
                <p className="monarch-muted">You sign in to GoHighLevel and choose the account that should receive leads. We never see your GoHighLevel password. We ask only to add contacts and tags and to read your account name.</p>
                <button className="monarch-primary" disabled={connecting}>{v.provider === "highlevel" ? "Reconnect GoHighLevel" : "Connect GoHighLevel"}</button>
              </form>
            ) : (
              <p className="monarch-notice"><b>The one-click GoHighLevel connection isn&apos;t switched on yet.</b> It&apos;s waiting on Monarch Tax Suite&apos;s GoHighLevel app approval. Until then, the Advanced option below connects GoHighLevel with a workflow link, and Monarch Tax Suite can walk you through it.</p>
            )}
            {note("ghl")}
            <details className="intg-advanced" open={feedback?.section === "hook" || undefined}>
              <summary>Advanced: connect with a workflow link</summary>
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
            <h2><span className="intg-num">3</span> Test your connection and turn on lead capture</h2>
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
        </>
      )}
    </div>
  );
}
