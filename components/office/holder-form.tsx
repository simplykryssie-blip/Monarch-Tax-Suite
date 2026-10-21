"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createWorkspaceAction, holderAccessAction, resendInviteAction, type HolderResult } from "@/app/(admin)/admin/workspaces/actions";

// Platform administrator: create an independent PTIN holder's workspace, and manage its owner's invite or access.
// If the email can't be sent, the one-time link is shown here to share by hand.

export function HolderForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<HolderResult | null>(null);
  const [copied, setCopied] = useState(false);
  const submit = (form: FormData) => {
    setCopied(false);
    start(async () => {
      const r = await createWorkspaceAction({ workspaceName: String(form.get("workspace") ?? ""), fullName: String(form.get("full_name") ?? ""), email: String(form.get("email") ?? "") });
      setResult(r);
      if (r.ok) router.refresh();
    });
  };
  return (
    <form action={submit} className="monarch-form">
      <label>PTIN holder&apos;s name<input name="full_name" required maxLength={200} autoComplete="off" /></label>
      <label>Email<input name="email" type="email" required maxLength={254} autoComplete="off" /></label>
      <label>Workspace name (optional)<input name="workspace" maxLength={120} autoComplete="off" placeholder="Defaults to their name" /></label>
      <div className="is-wide"><button className="monarch-primary" disabled={pending}>{pending ? "Creating…" : "Create workspace and send invite"}</button></div>
      {result && !result.ok && <p className="efin-form-error is-wide" role="alert">{result.error}</p>}
      {result && result.ok && (
        <div className="monarch-notice is-wide" role="status">
          {result.message}
          {result.link && (
            <div className="office-link">
              <input readOnly value={result.link} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
              <button type="button" className="monarch-secondary efin-small" onClick={() => navigator.clipboard.writeText(result.link!).then(() => setCopied(true), () => undefined)}>{copied ? "Copied" : "Copy link"}</button>
            </div>
          )}
        </div>
      )}
    </form>
  );
}

export function HolderRowActions({ tenantId, memberId, workspace, status, accepted }: { tenantId: string; memberId: string; workspace: string; status: string; accepted: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string; link?: string | null }>) => start(async () => {
    const r = await fn();
    setMessage(r.ok ? (r.message ?? null) : (r.error ?? "That did not work."));
    if (r.ok) router.refresh();
  });
  const change = (c: "withdraw" | "suspend" | "reactivate") => run(() => holderAccessAction({ tenantId, memberId, change: c }));
  return (
    <div className="office-people">
      {!accepted && <button type="button" className="monarch-secondary efin-small" disabled={pending} onClick={() => run(() => resendInviteAction({ tenantId, memberId, workspace }))}>{status === "invited" ? "Send a new link" : "Invite again"}</button>}
      {!accepted && status === "invited" && <button type="button" className="monarch-secondary efin-small" disabled={pending} onClick={() => change("withdraw")}>Withdraw</button>}
      {accepted && status === "active" && <button type="button" className="monarch-secondary efin-small" disabled={pending} onClick={() => change("suspend")}>Suspend</button>}
      {accepted && status === "suspended" && <button type="button" className="monarch-secondary efin-small" disabled={pending} onClick={() => change("reactivate")}>Reactivate</button>}
      {message && <p className="monarch-muted" role="status">{message}</p>}
    </div>
  );
}
