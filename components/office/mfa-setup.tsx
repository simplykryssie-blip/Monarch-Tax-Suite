"use client";

import { useState, useTransition } from "react";
import { startMfaEnrollAction, verifyMfaAction } from "@/app/office/actions";

// Two-step sign-in with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…). Required
// for every account in the office area, as the FTC Safeguards Rule requires for systems that reach client data.

export function MfaSetup({ hasFactor }: { hasFactor: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [enroll, setEnroll] = useState<{ factorId: string; qr: string; secret: string } | null>(null);

  const begin = () => start(async () => {
    setError(null);
    const r = await startMfaEnrollAction();
    if (!r.ok) setError(r.error);
    else setEnroll({ factorId: r.factorId, qr: r.qr, secret: r.secret });
  });
  const verify = (form: FormData) => start(async () => {
    setError(null);
    const r = await verifyMfaAction({ factorId: enroll?.factorId, code: String(form.get("code") ?? "") });
    if (r && !r.ok) setError(r.error);
  });

  if (!hasFactor && !enroll) {
    return (
      <div className="office-mfa">
        <p>You&apos;ll need an authenticator app on your phone. Scan the code it shows you, then type in the 6-digit number it gives you.</p>
        <button type="button" className="monarch-primary" onClick={begin} disabled={pending}>{pending ? "Starting…" : "Set up two-step sign-in"}</button>
        {error && <p className="efin-form-error" role="alert">{error}</p>}
      </div>
    );
  }
  return (
    <form action={verify} className="office-mfa">
      {enroll && (
        <>
          <p>Scan this with your authenticator app:</p>
          {/* The QR code comes back from Supabase as an SVG data URL. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enroll.qr} alt="QR code for your authenticator app" width={200} height={200} className="office-qr" />
          <p className="monarch-muted">Can&apos;t scan it? Enter this key in the app instead: <code>{enroll.secret}</code></p>
        </>
      )}
      <label htmlFor="code">{enroll ? "Then enter the 6-digit code it shows" : "Enter the 6-digit code from your authenticator app"}</label>
      <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required autoFocus />
      <button className="monarch-primary" disabled={pending}>{pending ? "Checking…" : "Continue"}</button>
      {error && <p className="efin-form-error" role="alert">{error}</p>}
    </form>
  );
}
