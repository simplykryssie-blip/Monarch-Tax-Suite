import { PLATFORM } from "@/lib/platform-brand";
import type { Brand } from "@/lib/branding/brand.ts";

/**
 * Split-screen frame for the sign-in family of pages: brand panel on the left, the form on the right. Shows Verexa HQ,
 * or the account's own brand when it white-labels sign-in and the visitor came in on the account's address.
 */
export function AuthFrame({ children, brand }: { children: React.ReactNode; brand?: Brand | null }) {
  const white = brand?.whiteLabelAdmin ? brand : null;
  return (
    <div className="mt-login">
      <section className="mt-login-brand" aria-hidden="true" style={white ? { background: `radial-gradient(90% 80% at 30% 20%, ${white.primary} 0%, ${white.sidebar} 75%), ${white.sidebar}` } : undefined}>
        {white ? (
          <>
            {white.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={white.logoUrl} alt="" width={1000} height={400} />
            ) : (
              <h2 className="mt-login-name">{white.name}</h2>
            )}
            {white.tagline && <p>{white.tagline}</p>}
          </>
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={PLATFORM.logoFull} alt="" width={1000} height={977} />
            <small>The CRM and automation platform for tax professionals.</small>
          </>
        )}
      </section>
      <section className="mt-login-form">{children}</section>
    </div>
  );
}
