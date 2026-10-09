"use client";

import { useActionState } from "react";
import {
  disconnectAction,
  portalSignInAction,
  retryLeadsAction,
  saveLeadSettingsAction,
  testConnectionAction,
  type PortalState,
} from "@/app/portal/actions";
import type { LeadSettings } from "@/lib/crm/types.ts";

function Message({ state }: { state: PortalState }) {
  if (!state.message) return null;
  return <p className={state.ok ? "monarch-alert" : "monarch-alert is-error"} role={state.ok ? "status" : "alert"}>{state.message}</p>;
}

export function SignInForm() {
  const [state, action, pending] = useActionState<PortalState, FormData>(portalSignInAction, {});
  return (
    <form action={action} className="monarch-form">
      <label className="is-wide">
        License key
        <input name="license_key" required autoComplete="off" spellCheck={false} placeholder="MTS-XXXXX-XXXXX-XXXXX-XXXXX" />
      </label>
      <div className="is-wide"><button className="monarch-primary" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button></div>
      <div className="is-wide"><Message state={state} /></div>
    </form>
  );
}

export function ConnectionActions({ canTest, canDisconnect }: { canTest: boolean; canDisconnect: boolean }) {
  const [testState, test, testing] = useActionState<PortalState>(testConnectionAction, {});
  const [discState, disc, disconnecting] = useActionState<PortalState>(disconnectAction, {});
  return (
    <>
      <div className="monarch-inline-actions">
        {canTest && <form action={test}><button className="monarch-secondary" disabled={testing}>{testing ? "Testing…" : "Test connection"}</button></form>}
        {canDisconnect && (
          <form action={disc} onSubmit={(e) => { if (!window.confirm("Disconnect GoHighLevel? Leads will stop being delivered and the lead form will be turned off.")) e.preventDefault(); }}>
            <button className="monarch-secondary is-danger" disabled={disconnecting}>{disconnecting ? "Disconnecting…" : "Disconnect"}</button>
          </form>
        )}
      </div>
      <Message state={testState} />
      <Message state={discState} />
    </>
  );
}

export function RetryButton() {
  const [state, action, pending] = useActionState<PortalState>(retryLeadsAction, {});
  return (
    <>
      <form action={action}><button className="monarch-secondary" disabled={pending}>{pending ? "Retrying…" : "Retry undelivered leads"}</button></form>
      <Message state={state} />
    </>
  );
}

export function LeadSettingsForm({ settings, connected }: { settings: LeadSettings; connected: boolean }) {
  const [state, action, pending] = useActionState<PortalState, FormData>(saveLeadSettingsAction, {});
  return (
    <form action={action} className="monarch-form">
      <label className="monarch-check is-wide">
        <input type="checkbox" name="enabled" defaultChecked={settings.enabled} disabled={!connected && !settings.enabled} /> Show the lead form on my calculator and send leads to my GoHighLevel sub-account
      </label>
      <label>Business name (shown to visitors)<input name="business_name" maxLength={120} defaultValue={settings.business_name ?? ""} placeholder="Your business name" /></label>
      <label>Lead source in GoHighLevel<input name="lead_source" maxLength={80} defaultValue={settings.lead_source} /></label>
      <label className="is-wide">Tags to add (comma separated, optional)<input name="tags" maxLength={500} defaultValue={settings.tags.join(", ")} placeholder="tax-calculator-lead" /></label>
      <label className="monarch-check is-wide">
        <input type="checkbox" name="include_summary" defaultChecked={settings.include_summary} /> Add a note with the estimate summary (tax year, filing status, estimated refund or amount owed). Visitors are told this before they submit. Income figures are never sent.
      </label>
      <label className="monarch-check is-wide">
        <input type="checkbox" name="update_existing" defaultChecked={settings.update_existing} /> Update an existing matching contact with the submitted name, email and phone. When off, existing contacts are left unchanged and only tags and the note are added.
      </label>
      <div className="is-wide"><button className="monarch-primary" disabled={pending}>{pending ? "Saving…" : "Save lead settings"}</button></div>
      <div className="is-wide"><Message state={state} /></div>
    </form>
  );
}
