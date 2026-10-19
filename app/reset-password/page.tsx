import Link from "next/link";
import { AuthFrame } from "@/components/auth-frame";
import { updatePassword } from "@/lib/auth-actions";
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
        <button type="submit" className="monarch-primary mt-login-go">Update password</button>
        <Link href="/" className="mt-login-link mt-login-back">Cancel</Link>
      </form>
    </AuthFrame>
  );
}
