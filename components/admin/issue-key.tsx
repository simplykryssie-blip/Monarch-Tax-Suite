"use client";

import { useActionState } from "react";
import { issueLicenseKeyAction, type IssueKeyState } from "@/app/(admin)/actions";

export function IssueKeyForm({ licenseId, rotating }: { licenseId: string; rotating: boolean }) {
  const [state, action, pending] = useActionState<IssueKeyState, FormData>(issueLicenseKeyAction, {});
  return (
    <div className="monarch-keybox">
      {state.key ? (
        <div role="status">
          <b>License key — copy it now. It will not be shown again.</b>
          <code className="monarch-key">{state.key}</code>
        </div>
      ) : (
        <form action={action}>
          <input type="hidden" name="id" value={licenseId} />
          <button className="monarch-primary" disabled={pending} type="submit">
            {pending ? "Issuing…" : rotating ? "Rotate key (invalidates the current key)" : "Issue license key"}
          </button>
        </form>
      )}
      {state.error && <p className="monarch-alert is-error">{state.error}</p>}
    </div>
  );
}
