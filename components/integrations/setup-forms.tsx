"use client";

import { useActionState, useState } from "react";
import { activateAction, connectHighLevelAction, disconnectAction, lookupAction, saveSettingsAction, setWebhookAction, testAction, type SetupState } from "@/app/integrations/actions";

// Three plain steps: activate, connect, test and turn on. Every form sends the license key typed
// on this page; nothing is remembered after the page closes. Webhook and signing-secret details
// live only under "Advanced" in step 2.
export function SetupForms({ highlevelAvailable }: { highlevelAvailable: boolean }) {
  const [key, setKey] = useState("");
  const [domain, setDomain] = useState("");
  const [state, setState] = useState<SetupState>({});
  const wrap = (fn: (p: SetupState, f: FormData) => Promise<SetupState>) => async (prev: SetupState, f: FormData) => {
    const next = await fn(prev, f);
    setState((s) => ({ ...next, view: next.view ?? s.view, signingSecret: next.signingSecret }));
    return next;
  };
  const [, lookup, looking] = useActionState(wrap(lookupAction), {});
  const [, activate, activating] = useActionState(wrap(activateAction), {});
  const [, hook, hooking] = useActionState(wrap(setWebhookAction), {});
  const [, test, testing] = useActionState(wrap(testAction), {});
  const [, disc, disconnecting] = useActionState(wrap(disconnectAction), {});
  const [, save, saving] = useActionState(wrap(saveSettingsAction), {});
  const [, ghl, connecting] = useActionState(wrap(connectHighLevelAction), {});
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
      {state.message && <p className={`monarch-alert${state.ok ? "" : " is-error"}`} role={state.ok ? "status" : "alert"}>{state.message}</p>}

      {v && status && (
        <>
          <p className="intg-status" data-state={status.key}><b>{status.label}</b> {status.detail}</p>

          <section className="intg-step">
            <h2><span className="intg-num">1</span> Activate your calculator {activated && <span className="intg-done">Done</span>}</h2>
            {activated ? (
              <p>Your calculator is activated for <b>{v.domains.join(", ")}</b> (and the www version).</p>
            ) : (
              <>
                <p className="monarch-muted">Enter your main website address, not a page. For example <code>yourbusiness.com</code>. The calculator will show only on this website.</p>
                <form action={activate} className="intg-row">
                  {hidden}
                  <label>Your website address<input name="domain" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="yourbusiness.com" required /></label>
                  <button className="monarch-secondary" disabled={activating}>Review</button>
                </form>
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
            <details className="intg-advanced">
              <summary>Advanced: connect with a workflow link</summary>
              <p className="monarch-muted">
                In GoHighLevel, create a workflow that starts with &quot;Inbound Webhook&quot;, and paste its link here. The workflow must also be set up to create the contact and send any email; the link alone does neither.
                Saving a link replaces any GoHighLevel connection and creates a new signing secret, shown once.
              </p>
              <form action={hook} className="intg-row">
                {hidden}
                <label>Workflow link (https)<input name="webhook_url" required maxLength={2000} placeholder="https://services.leadconnectorhq.com/hooks/…" /></label>
                <button className="monarch-secondary" disabled={hooking}>{hooking ? "Saving…" : "Save link"}</button>
              </form>
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
                  <form action={test}>{hidden}<button className="monarch-primary" disabled={testing}>{testing ? "Testing…" : "Test connection"}</button></form>
                  <form action={disc}>{hidden}<button className="monarch-secondary is-danger" disabled={disconnecting}>Disconnect</button></form>
                </div>
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
                  <div className="is-wide"><button className="monarch-primary" disabled={saving}>{saving ? "Saving…" : "Save"}</button></div>
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
