"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isTokenHash, RESET_LINK_EXPIRED, RESET_LINK_INVALID } from "./auth-links.ts";
import { clientAddress, hashClient, windowStart } from "./commerce/rate-limit.ts";
import { rateLimitStore } from "./rate-limit-server";
import { createClient } from "./supabase/server";

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const requested = String(formData.get("next") ?? "/");
  // Only allow same-site relative paths to prevent open redirects.
  const next = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/";

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}&next=${encodeURIComponent(next)}`);
  }

  redirect(next);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/** Where the reset email should send the person back to: the branded address in Production, this host elsewhere. */
async function resetOrigin(): Promise<string> {
  if (process.env.VERCEL_ENV === "production" && process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return `${host.startsWith("localhost") ? "http" : "https"}://${host}`;
}

/**
 * Sends a password-reset email. The answer is always the same ("if that email belongs to an account..."), so this cannot
 * be used to find out who has an account. Limited per address of the requester; Supabase also rate-limits per account.
 */
export async function requestPasswordReset(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase().slice(0, 254);
  const h = await headers();
  const ip = clientAddress(h.get("x-forwarded-for"));
  try {
    if (ip) {
      const hits = await rateLimitStore().hit(`pwreset:${hashClient(ip, process.env.MONARCH_ENCRYPTION_KEY)}`, windowStart(Date.now()).startIso);
      if (hits > 5) redirect("/forgot-password?error=" + encodeURIComponent("Too many requests. Please wait a minute and try again."));
    }
  } catch (e) {
    if (e instanceof Error && e.message === "NEXT_REDIRECT") throw e;
    // The counter store may not be installed; Supabase still limits resets per account.
  }
  if (/^[^\s@]{1,64}@[^\s@]{1,255}$/.test(email)) {
    try {
      const supabase = await createClient();
      await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${await resetOrigin()}/auth/callback` });
    } catch {
      // Never reveal whether the address exists or the email could be sent.
    }
  }
  redirect("/forgot-password?sent=1");
}

/** Sets a new password for the person signed in (including the short session from a reset link). */
export async function updatePassword(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  const back = (message: string): never => redirect("/reset-password?error=" + encodeURIComponent(message));
  if (password.length < 12) back("Use at least 12 characters.");
  if (password !== confirm) back("The two passwords do not match.");
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/forgot-password?error=" + encodeURIComponent("Your reset link expired. Request a new one."));
  const { error } = await supabase.auth.updateUser({ password });
  if (error) back(error.message.includes("same") ? "Choose a password you have not used before." : "The password could not be updated. Try a longer or less common password.");
  redirect("/?notice=" + encodeURIComponent("Your password was updated."));
}

/**
 * Redeems the token in an emailed reset link (/auth/confirm). Unlike the one-time code on /auth/callback it needs nothing from
 * the browser that asked for the reset, so it works from a phone's mail app. It runs only when the person presses the button
 * on the confirm page, so a mail scanner that merely fetches the link cannot use it up.
 */
export async function confirmRecoveryLink(formData: FormData) {
  const tokenHash = formData.get("token_hash");
  if (!isTokenHash(tokenHash)) redirect("/forgot-password?error=" + encodeURIComponent(RESET_LINK_INVALID));
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
  if (error) redirect("/forgot-password?error=" + encodeURIComponent(RESET_LINK_EXPIRED));
  redirect("/reset-password");
}
