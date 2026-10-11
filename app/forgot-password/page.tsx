import Link from "next/link";
import { AuthFrame } from "@/components/auth-frame";
import { requestPasswordReset } from "@/lib/auth-actions";

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ sent?: string; error?: string }> }) {
  const { sent, error } = await searchParams;
  return (
    <AuthFrame>
      <form action={requestPasswordReset}>
        <h1>Reset your password</h1>
        <p className="mt-login-sub">Enter your email and we will send you a link to choose a new password.</p>
        {sent && <p className="mt-login-notice" role="status">If that email belongs to an account, a reset link is on its way. It expires in about an hour. Check your spam folder too.</p>}
        {error && <p className="mt-login-error" role="alert">{error}</p>}
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required />
        <button type="submit" className="monarch-primary mt-login-go">Email me a reset link</button>
        <Link href="/login" className="mt-login-link mt-login-back">← Back to sign in</Link>
      </form>
    </AuthFrame>
  );
}
