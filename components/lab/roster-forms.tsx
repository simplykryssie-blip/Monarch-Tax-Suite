"use client";

import { useActionState, useState } from "react";
import { inviteAction, reissueAction, type InviteState } from "@/app/lab/actions";

function Links({ state }: { state: InviteState }) {
  const [copied, setCopied] = useState<string | null>(null);
  if (state.error) return <div className="lab-notice bad" role="alert">{state.error}</div>;
  if (!state.links?.length) return null;
  const copy = async (url: string) => {
    try { await navigator.clipboard.writeText(url); setCopied(url); } catch { setCopied(null); }
  };
  return (
    <div className="lab-notice good lab-stack">
      <b>Send each student their own link.</b>
      <span className="lab-small">Each link works once and lasts 30 days. They aren’t shown again, so copy them now (you can make a new one later).</span>
      {state.links.map((l) => (
        <div key={l.url} className="lab-stack" style={{ gap: 4 }}>
          <span className="lab-small"><b>{l.email}</b></span>
          <div className="lab-copy">
            <input type="text" readOnly value={l.url} onFocus={(e) => e.currentTarget.select()} aria-label={`Join link for ${l.email}`} />
            <button type="button" className="lab-btn sm" onClick={() => copy(l.url)}>{copied === l.url ? "Copied" : "Copy"}</button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function InviteForm({ open }: { open: number }) {
  const [state, action, pending] = useActionState(inviteAction, {} as InviteState);
  return (
    <form action={action} className="lab-stack">
      <label className="f">Student email addresses <span className="hint">(separate with commas or new lines)</span>
        <textarea name="emails" rows={3} required placeholder={"jordan@example.com\nkeisha@example.com"} />
      </label>
      <div className="lab-row"><button type="submit" className="lab-btn primary" disabled={pending || open <= 0}>{pending ? "Creating links…" : "Create join links"}</button><span className="lab-small lab-muted">{open} open seat{open === 1 ? "" : "s"}</span></div>
      <Links state={state} />
    </form>
  );
}

export function ReissueButton({ memberId }: { memberId: string }) {
  const [state, action, pending] = useActionState(reissueAction, {} as InviteState);
  return (
    <form action={action} className="lab-stack" style={{ gap: 6 }}>
      <input type="hidden" name="member_id" value={memberId} />
      <button type="submit" className="lab-btn sm" disabled={pending}>New join link</button>
      <Links state={state} />
    </form>
  );
}
