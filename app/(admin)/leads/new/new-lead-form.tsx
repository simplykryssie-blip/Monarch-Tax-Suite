"use client";

import { useActionState } from "react";
import { createLeadAction, type LeadFormState } from "../actions";
import { LeadFields } from "../fields";

export function NewLeadForm() {
  const [state, action, pending] = useActionState<LeadFormState, FormData>(createLeadAction, undefined);
  return (
    <form action={action} className="monarch-panel monarch-form" style={{ padding: 20 }} key={state ? JSON.stringify(state.values) : "new"}>
      {state?.error && <p className="monarch-notice is-wide" role="alert">{state.error}</p>}
      <LeadFields v={state?.values ?? {}} />
      <div className="is-wide"><button className="monarch-primary" disabled={pending}>{pending ? "Adding…" : "Add lead"}</button></div>
    </form>
  );
}
