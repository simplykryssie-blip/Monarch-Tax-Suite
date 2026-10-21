import type { Metadata } from "next";
import Link from "next/link";
import { AuthFrame } from "@/components/auth-frame";
import { signupState } from "@/lib/billing/open.ts";
import { dollars, PLANS } from "@/lib/billing/plans.ts";
import { billingDeps } from "@/lib/billing/server";
import { signupFromLink } from "@/lib/billing/service.ts";
import { PLATFORM } from "@/lib/platform-brand";
import { continueToPaymentAction } from "../../actions";

export const metadata: Metadata = { title: `Confirm your email | ${PLATFORM.name}`, robots: { index: false, follow: false } };

/** The link in the confirmation email: the address is confirmed, and the next step is payment. */
export default async function VerifyPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string }> }) {
  const { token } = await params;
  const { error } = await searchParams;
  const deps = signupState(process.env).open ? billingDeps() : null;
  const claims = deps ? signupFromLink(deps, token) : null;
  return (
    <AuthFrame>
      {claims ? (
        <form action={continueToPaymentAction}>
          <h1>Your email is confirmed</h1>
          <p className="mt-login-sub">Next is payment on Stripe&apos;s secure page. Your account is created as soon as it goes through.</p>
          <dl className="su-summary">
            <dt>Plan</dt><dd>{PLANS[claims.plan].label}, {dollars(PLANS[claims.plan].priceCents)} per month</dd>
            <dt>Name</dt><dd>{claims.name}</dd>
            <dt>Workspace</dt><dd>{claims.workspace}</dd>
            <dt>Email</dt><dd>{claims.email}</dd>
          </dl>
          <input type="hidden" name="token" value={token} />
          {error && <p className="mt-login-error" role="alert">{error}</p>}
          <button type="submit" className="monarch-primary mt-login-go">Continue to payment</button>
          <small className="mt-login-foot">You will be charged {dollars(PLANS[claims.plan].priceCents)} now, then every month until you cancel.</small>
        </form>
      ) : (
        <div>
          <h1>This link has expired</h1>
          <p className="mt-login-sub">The link is no longer valid. <Link href="/signup">Start again</Link> and we&apos;ll send a new one.</p>
        </div>
      )}
    </AuthFrame>
  );
}
