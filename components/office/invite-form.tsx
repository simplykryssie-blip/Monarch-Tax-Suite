"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { bureauInviteAction, invitePreparerAction, type InviteSent } from "@/app/office/actions";

// Invite someone to an office. The ERO invites preparers to their own office; the bureau can invite an ERO or a
// preparer to any office. If the email can't be sent, the one-time link is shown here to share by hand.

type Props = { mode: "ero" } | { mode: "bureau"; offices: { id: string; name: string }[]; defaultOffice?: string };

export function InviteForm(props: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<InviteSent | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = (form: FormData) => {
    setCopied(false);
    start(async () => {
      const input = { email: String(form.get("email") ?? ""), fullName: String(form.get("full_name") ?? "") };
      const r = props.mode === "ero"
        ? await invitePreparerAction(input)
        : await bureauInviteAction({ ...input, officeId: String(form.get("office_id") ?? ""), role: String(form.get("role") ?? "ero") });
      setResult(r);
      if (r.ok) router.refresh();
    });
  };

  return (
    <form action={submit} className="monarch-form">
      {props.mode === "bureau" && (
        <>
          <label>Office<select name="office_id" required defaultValue={props.defaultOffice ?? ""}><option value="">Choose the office…</option>{props.offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
          <label>Role<select name="role" defaultValue="ero"><option value="ero">ERO</option><option value="preparer">Preparer (PTIN holder)</option></select></label>
        </>
      )}
      <label>Full name<input name="full_name" required maxLength={200} autoComplete="off" /></label>
      <label>Email<input name="email" type="email" required maxLength={254} autoComplete="off" /></label>
      <div className="is-wide"><button className="monarch-primary" disabled={pending}>{pending ? "Sending…" : props.mode === "ero" ? "Invite preparer" : "Send invite"}</button></div>
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
