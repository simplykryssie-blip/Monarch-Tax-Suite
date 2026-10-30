import Link from "next/link";
import { AuthFrame } from "@/components/auth-frame";
import { updatePassword } from "@/lib/auth-actions";
import { needsTwoStepCode } from "@/lib/password-reset";
import { createClient } from "@/lib/supabase/server";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return (
      <AuthFrame>
        <div className="mt-login-card">
          <h1>Link expired</h1>
          <p className="mt-login-sub">This password reset link is invalid or has expired. Request a new one.</p>
          <Link href="/forgot-password" className="monarch-primary mt-login-go">Request a new link</Link>
        </div>
      </AuthFrame>
    );
  }
  const [{ data: factors }, { data: aal }] = await Promise.all([supabase.auth.mfa.listFactors(), supabase.auth.mfa.getAuthenticatorAssuranceLevel()]);
  const askCode = needsTwoStepCode({ hasVerifiedFactor: !!factors?.totp.some((f) => f.status === "verified"), level: aal?.currentLevel });
  return (
    <AuthFrame>
      <form action={updatePassword}>
        <h1>Choose a new password</h1>
        <p className="mt-login-sub">Signed in as {user.email}. Use at least 12 characters.</p>
        {error && <p className="mt-login-error" role="alert">{error}</p>}
        <label htmlFor="password">New password</label>
        <input id="password" name="password" type="password" autoComplete="new-password" minLength={12} required />
        <label htmlFor="confirm">Confirm new password</label>
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={12} required />
        {askCode && (
          <>
            <label htmlFor="code">Authenticator code</label>
            <input id="code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} placeholder="6-digit code" required />
            <p className="mt-login-sub">This account uses two-step sign-in, so we need the current code from your authenticator app to change the password.</p>
          </>
        )}
        <button type="submit" className="monarch-primary mt-login-go">Update password</button>
        <Link href="/" className="mt-login-link mt-login-back">Cancel</Link>
      </form>
    </AuthFrame>
  );
}
