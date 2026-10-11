import { signIn } from "@/lib/auth-actions";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const { error, next } = await searchParams;
  return (
    <div className="mt-login">
      <section className="mt-login-brand" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/logo.png" alt="" width={1000} height={253} />
        <p>Software · Tools · Training · Growth</p>
        <small>The operating system for your tax business.</small>
      </section>
      <section className="mt-login-form">
        <form action={signIn}>
          <h1>Welcome back</h1>
          <p className="mt-login-sub">Sign in to your Monarch Tax Suite workspace.</p>
          <input type="hidden" name="next" value={next ?? "/"} />
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" defaultValue="info@monarchtaxsuite.com" required />
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required />
          {error && <p className="mt-login-error" role="alert">{error}</p>}
          <button type="submit" className="monarch-primary mt-login-go">Sign in</button>
          <small className="mt-login-foot">Authorized administrators only. Activity is recorded.</small>
        </form>
      </section>
    </div>
  );
}
