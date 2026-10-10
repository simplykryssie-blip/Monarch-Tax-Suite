"use client";

import { useActionState } from "react";
import { requestNewLinkAction, type NewLinkState } from "@/app/setup/actions";

/** Shown when a visitor has no valid setup session, for example an expired or revoked link. */
export function NewLinkForm() {
  const [state, action, pending] = useActionState<NewLinkState, FormData>(requestNewLinkAction, {});
  return (
    <form action={action} className="intg-step">
      <h2>Need a new setup link?</h2>
      <p className="monarch-muted">Enter the email address you used for your Monarch Tax Suite license and we will send a fresh link.</p>
      <div className="intg-row">
        <label>Email address<input name="email" type="email" required maxLength={254} autoComplete="email" /></label>
        <button className="monarch-secondary" disabled={pending}>{pending ? "Sending…" : "Email me a new link"}</button>
      </div>
      {state.message && <p className={`monarch-alert${state.ok ? " is-ok" : " is-error"}`} role="status">{state.message}</p>}
    </form>
  );
}
