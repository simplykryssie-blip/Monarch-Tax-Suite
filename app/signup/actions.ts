"use server";

import { headers } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { signupState } from "@/lib/billing/open.ts";
import { billingDeps, ipHashOf } from "@/lib/billing/server";
import { requestSignup, startCheckout } from "@/lib/billing/service.ts";

export type SignupResult = { ok: true; message: string } | { ok: false; error: string } | undefined;

const failure = (e: unknown) => {
  if (e instanceof ValidationError) return e.message;
  console.error(`signup failed: ${sanitizeError(e, 200)}`);
  return "That did not work. Nothing was charged. Please try again.";
};

/** Step one: details and plan. The answer is the same whether or not the email already has an account. */
export async function requestSignupAction(_prev: SignupResult, form: FormData): Promise<SignupResult> {
  try {
    if (!signupState(process.env).open) throw new ValidationError("Signup isn't open yet.");
    const deps = billingDeps();
    if (!deps) throw new ValidationError("Signup isn't open yet.");
    const { ip, hash } = ipHashOf((await headers()).get("x-forwarded-for"));
    const field = (k: string) => form.get(k);
    const result = await requestSignup(deps, { email: field("email"), name: field("name"), workspace: field("workspace"), plan: field("plan"), agree: field("agree") === "on" }, {
      ipHash: hash, ip, captchaToken: typeof field("cf-turnstile-response") === "string" ? (field("cf-turnstile-response") as string) : null,
    });
    return { ok: true, message: result.message };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: failure(e) };
  }
}

/** Step two: the confirmed link goes on to Stripe's payment page. */
export async function continueToPaymentAction(form: FormData) {
  const token = typeof form.get("token") === "string" ? (form.get("token") as string) : "";
  let url: string;
  try {
    if (!signupState(process.env).open) throw new ValidationError("Signup isn't open yet.");
    const deps = billingDeps();
    if (!deps) throw new ValidationError("Signup isn't open yet.");
    url = (await startCheckout(deps, token)).url;
  } catch (e) {
    unstable_rethrow(e);
    redirect(`/signup/verify/${encodeURIComponent(token)}?error=${encodeURIComponent(failure(e))}`);
  }
  redirect(url);
}
