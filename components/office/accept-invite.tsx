"use client";

import { useState, useTransition } from "react";
import { acceptNewAccountAction, acceptSignedInAction } from "@/app/office/actions";

// Accepting an office invite: choose a password (a new account), or accept with the account already signed in.

export function AcceptInvite({ token, email, signedInAs }: { token: string; email: string; signedInAs: string | null }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (signedInAs) {
    const matches = signedInAs.toLowerCase() === email.toLowerCase();
    return (
      <div className="office-mfa">
        {matches ? (
          <button type="button" className="monarch-primary" disabled={pending} onClick={() => start(async () => { const r = await acceptSignedInAction(token); if (r && !r.ok) setError(r.error); })}>{pending ? "Accepting…" : `Accept as ${signedInAs}`}</button>
        ) : (
          <p>You&apos;re signed in as <b>{signedInAs}</b>, but this invite is for <b>{email}</b>. Sign out, then open this link again.</p>
        )}
        {error && <p className="efin-form-error" role="alert">{error}</p>}
      </div>
    );
  }
  const submit = (form: FormData) => start(async () => {
    setError(null);
    const p = String(form.get("password") ?? "");
    if (p !== String(form.get("confirm") ?? "")) { setError("The two passwords don't match."); return; }
    const r = await acceptNewAccountAction(token, p);
    if (r && !r.ok) setError(r.error);
  });
  return (
    <form action={submit} className="office-mfa">
      <label htmlFor="email">Email</label>
      <input id="email" value={email} readOnly />
      <label htmlFor="password">Choose a password (at least 12 characters)</label>
      <input id="password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required />
      <label htmlFor="confirm">Type it again</label>
      <input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={12} maxLength={128} required />
      <button className="monarch-primary" disabled={pending}>{pending ? "Creating your account…" : "Create account"}</button>
      {error && <p className="efin-form-error" role="alert">{error}</p>}
    </form>
  );
}
