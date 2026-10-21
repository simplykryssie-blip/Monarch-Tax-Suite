import type { Metadata } from "next";
import Link from "next/link";
import { AuthFrame } from "@/components/auth-frame";
import { SignupForm } from "@/components/signup/signup-form";
import { signupState } from "@/lib/billing/open.ts";
import { dollars, PLANS } from "@/lib/billing/plans.ts";
import { PLATFORM } from "@/lib/platform-brand";

export const metadata: Metadata = { title: `Create your account | ${PLATFORM.name}`, robots: { index: false, follow: false } };

export const dynamic = "force-dynamic";

export default function SignupPage() {
  const state = signupState(process.env);
  const production = process.env.VERCEL_ENV === "production";
  return (
    <AuthFrame>
      {state.open ? (
        <SignupForm
          siteKey={process.env.TURNSTILE_SITE_KEY || null}
          plans={Object.values(PLANS).map((p) => ({ key: p.key, label: p.label, price: dollars(p.priceCents), summary: p.summary, selfServe: p.selfServe }))}
        />
      ) : (
        <div>
          <h1>Signup isn&apos;t open yet</h1>
          <p className="mt-login-sub">New accounts aren&apos;t being created on this site yet. Please check back soon.</p>
          {!production && (<ul className="monarch-muted">{state.reasons.map((r) => <li key={r}>{r}</li>)}</ul>)}
        </div>
      )}
      <p className="mt-login-foot" style={{ marginTop: 16 }}>Already have an account? <Link href="/login">Sign in</Link></p>
    </AuthFrame>
  );
}
