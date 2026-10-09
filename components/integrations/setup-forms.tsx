"use client";

import { useActionState, useState } from "react";
import { connectHighLevelAction, disconnectAction, lookupAction, saveSettingsAction, setWebhookAction, testAction, type SetupState } from "@/app/integrations/actions";

// Every form sends the license key typed on this page; nothing is remembered after the page closes.
export function SetupForms({ highlevelAvailable }: { highlevelAvailable: boolean }) {
  const [key, setKey] = useState("");
  const [state, setState] = useState<SetupState>({});
  const wrap = (fn: (p: SetupState, f: FormData) => Promise<SetupState>) => async (prev: SetupState, f: FormData) => {
    const next = await fn(prev, f);
    setState((s) => ({ ...next, view: next.view ?? s.view, signingSecret: next.signingSecret }));
    return next;
  };
  const [, lookup, looking] = useActionState(wrap(lookupAction), {});
  const [, hook, hooking] = useActionState(wrap(setWebhookAction), {});
  const [, test, testing] = useActionState(wrap(testAction), {});
  const [, disc, disconnecting] = useActionState(wrap(disconnectAction), {});
  const [, save, saving] = useActionState(wrap(saveSettingsAction), {});
  const [, ghl, connecting] = useActionState(wrap(connectHighLevelAction), {});
  const v = state.view;

  return (
    <div className="monarch-form">
      <form action={lookup} className="is-wide intg-key">
        <label>License key<input name="license_key" type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} placeholder="MTS-XXXXX-XXXXX-XXXXX-XXXXX" required /></label>
        <button className="monarch-primary" disabled={looking}>{looking ? "Checking…" : "Show my settings"}</button>
      </form>
      {state.message && <p className={`is-wide monarch-alert${state.ok ? "" : " is-error"}`} role={state.ok ? "status" : "alert"}>{state.message}</p>}
      {state.signingSecret && <p className="is-wide monarch-notice"><b>SIGNING SECRET (SHOWN ONCE)</b> <code>{state.signingSecret}</code></p>}
      {v && (
        <>
          <section className="is-wide intg-section">
            <h2>Lead destination</h2>
            <p><b>{v.status}</b>{v.label ? ` · ${v.label}` : ""}{v.lastSuccess ? ` · last delivery ${new Date(v.lastSuccess).toLocaleString()}` : ""}</p>
            {v.lastError && <p className="intg-error">{v.lastError}</p>}
            <div className="monarch-inline-actions">
              {v.provider && <form action={test}><input type="hidden" name="license_key" value={key} /><button className="monarch-secondary" disabled={testing}>{testing ? "Testing…" : "Test destination"}</button></form>}
              {v.provider && <form action={disc}><input type="hidden" name="license_key" value={key} /><button className="monarch-secondary is-danger" disabled={disconnecting}>Disconnect</button></form>}
            </div>
          </section>
          <section className="is-wide intg-section">
            <h3>Option A · GoHighLevel</h3>
            {highlevelAvailable ? (
              <form action={ghl}><input type="hidden" name="license_key" value={key} /><p className="monarch-muted">You sign in on GoHighLevel and choose the sub-account that receives leads. Monarch never sees your password.</p><button className="monarch-secondary" disabled={connecting}>{v.provider === "highlevel" ? "Reconnect / change location" : "Connect GoHighLevel"}</button></form>
            ) : <p className="monarch-muted">Not available yet. Use a webhook (option B), which works with GoHighLevel workflows, Zapier, Make, n8n and other tools that accept webhooks.</p>}
          </section>
          <section className="is-wide intg-section">
            <h3>Option B · Webhook to your CRM or automation tool</h3>
            <form action={hook} className="intg-key"><input type="hidden" name="license_key" value={key} />
              <label>Webhook URL (https)<input name="webhook_url" required maxLength={2000} placeholder="https://hooks.example.com/…" /></label>
              <button className="monarch-secondary" disabled={hooking}>{hooking ? "Saving…" : "Save webhook"}</button>
            </form>
            <p className="monarch-muted">Each lead is sent once as JSON, signed with your secret (X-Monarch-Signature). Saving a URL replaces any GoHighLevel connection and issues a new secret.</p>
          </section>
          <section className="is-wide intg-section">
            <h2>Lead form</h2>
            <form action={save} className="monarch-form"><input type="hidden" name="license_key" value={key} />
              <label className="monarch-check is-wide"><input type="checkbox" name="enabled" defaultChecked={v.settings.enabled} /> Show the lead form on my calculator</label>
              <label>Business name (shown to visitors)<input name="business_name" maxLength={120} defaultValue={v.settings.business_name} /></label>
              <label>Lead source<input name="lead_source" maxLength={80} defaultValue={v.settings.lead_source} /></label>
              <label className="is-wide">Tags (comma separated)<input name="tags" maxLength={500} defaultValue={v.settings.tags} /></label>
              <label className="monarch-check is-wide"><input type="checkbox" name="include_summary" defaultChecked={v.settings.include_summary} /> Include the estimate summary (tax year, filing status, estimated refund or amount owed); visitors are told before submitting</label>
              <label className="monarch-check is-wide"><input type="checkbox" name="update_existing" defaultChecked={v.settings.update_existing} /> GoHighLevel: update a matching existing contact (otherwise existing contacts are left unchanged)</label>
              <div className="is-wide"><button className="monarch-primary" disabled={saving}>{saving ? "Saving…" : "Save lead form settings"}</button></div>
            </form>
          </section>
        </>
      )}
    </div>
  );
}
