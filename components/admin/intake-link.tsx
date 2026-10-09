"use client";

import { useActionState } from "react";
import { createIntakeLinkAction, type IntakeLinkState } from "@/app/(admin)/actions";

export function IntakeLinkButton({ installationId, submittedAt }: { installationId: string; submittedAt: string | null }) {
  const [state, action, pending] = useActionState<IntakeLinkState, FormData>(createIntakeLinkAction, {});
  return (
    <div className="monarch-keybox">
      {state.url ? (
        <div role="status">
          <b>Send this link to the customer. It works once and expires in 14 days; it will not be shown again.</b>
          <code className="monarch-key">{state.url}</code>
        </div>
      ) : (
        <form action={action}>
          <input type="hidden" name="id" value={installationId} />
          <p className="monarch-muted">{submittedAt ? "The customer already submitted details. A new link replaces any earlier one." : "Ask the customer for their platform, website URL, domain, and installation preference."}</p>
          <button className="monarch-secondary" disabled={pending} type="submit">{pending ? "Creating…" : "Create customer details link"}</button>
        </form>
      )}
      {state.error && <p className="monarch-alert is-error">{state.error}</p>}
    </div>
  );
}
