/** Split-screen frame for the sign-in family of pages: brand panel on the left, the form on the right. */
export function AuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-login">
      <section className="mt-login-brand" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/logo.png" alt="" width={1000} height={253} />
        <p>Software · Tools · Training · Growth</p>
        <small>The operating system for your tax business.</small>
      </section>
      <section className="mt-login-form">{children}</section>
    </div>
  );
}
