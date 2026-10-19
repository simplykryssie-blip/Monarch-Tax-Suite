"use client";

import Script from "next/script";
import { useActionState } from "react";
import { requestSignupAction, type SignupResult } from "@/app/signup/actions";

type Plan = { key: string; label: string; price: string; summary: string; selfServe: boolean };

/** Step one of signup: the plans, then the person's details. ERO and Service Bureau are shown but not yet open. */
export function SignupForm({ plans, siteKey }: { plans: Plan[]; siteKey: string | null }) {
  const [state, action, pending] = useActionState<SignupResult, FormData>(requestSignupAction, undefined);
  if (state?.ok) {
    return (
      <div role="status">
        <h1>Check your email</h1>
        <p>{state.message}</p>
      </div>
    );
  }
  return (
    <form action={action} className="su-form">
      <h1>Create your account</h1>
      <p className="mt-login-sub">Choose a plan. Your card is charged when you finish, and there is no free trial.</p>
      <fieldset className="su-plans">
        <legend className="su-legend">Plan</legend>
        {plans.map((p) => (
          <label key={p.key} className={`su-plan${p.selfServe ? "" : " is-off"}`}>
            <input type="radio" name="plan" value={p.key} defaultChecked={p.key === "ptin"} disabled={!p.selfServe} required />
            <span><b>{p.label}</b> <span className="su-price">{p.price}/month</span><small>{p.summary}{p.selfServe ? "" : " Not open for self-serve signup yet. Contact us to get started."}</small></span>
          </label>
        ))}
      </fieldset>
      <label htmlFor="name">Your name</label>
      <input id="name" name="name" autoComplete="name" required maxLength={200} />
      <label htmlFor="email">Email</label>
      <input id="email" name="email" type="email" autoComplete="email" required maxLength={254} />
      <label htmlFor="workspace">Workspace name <small className="monarch-muted">(optional; your name if blank)</small></label>
      <input id="workspace" name="workspace" maxLength={120} placeholder="For example, Pat's Tax Practice" />
      <label className="su-agree"><input type="checkbox" name="agree" required /> <span>I agree to the <a href="/legal/terms" target="_blank" rel="noreferrer">Terms of Service</a>, <a href="/legal/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>, <a href="/legal/refunds" target="_blank" rel="noreferrer">Refund Policy</a> and <a href="/legal/acceptable-use" target="_blank" rel="noreferrer">Acceptable Use Policy</a>.</span></label>
      {siteKey && (
        <>
          <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" />
          <div className="cf-turnstile" data-sitekey={siteKey} />
        </>
      )}
      {state && !state.ok && <p className="mt-login-error" role="alert">{state.error}</p>}
      <button type="submit" className="monarch-primary mt-login-go" disabled={pending}>{pending ? "Sending…" : "Continue"}</button>
      <small className="mt-login-foot">We&apos;ll email you a link to confirm your address before payment.</small>
    </form>
  );
}
