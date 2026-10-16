import Link from "next/link";
import { AuthFrame } from "@/components/auth-frame";
import { signIn } from "@/lib/auth-actions";
import { brandForRequestHost } from "@/lib/branding/server";
import { PLATFORM } from "@/lib/platform-brand";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string; next?: string }> }) {
  const { error, notice, next } = await searchParams;
  const brand = await brandForRequestHost().catch(() => null);
  const white = brand?.whiteLabelAdmin ? brand : null;
  return (
    <AuthFrame brand={white}>
      <form action={signIn}>
        <h1>Welcome back</h1>
        <p className="mt-login-sub">Sign in to your {white ? white.name : PLATFORM.name} workspace.</p>
        {notice && <p className="mt-login-notice" role="status">{notice}</p>}
        <input type="hidden" name="next" value={next ?? "/"} />
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required />
        <div className="mt-login-row">
          <label htmlFor="password">Password</label>
          <Link href="/forgot-password" className="mt-login-link">Forgot password?</Link>
        </div>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
        {error && <p className="mt-login-error" role="alert">{error}</p>}
        <button type="submit" className="monarch-primary mt-login-go">Sign in</button>
        <Link href="/forgot-password" className="monarch-secondary mt-login-reset">Reset password</Link>
        <small className="mt-login-foot">Authorized administrators only. Activity is recorded.</small>
      </form>
    </AuthFrame>
  );
}
