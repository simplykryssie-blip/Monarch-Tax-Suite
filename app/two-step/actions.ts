"use server";

import { redirect } from "next/navigation";
import { startMfaEnrollAction } from "@/app/office/actions";
import { factorToCheck } from "@/lib/admin-two-step.ts";
import { mfaState } from "@/lib/office/server";
import { recordSecurityEvent } from "@/lib/security-audit";
import { currentTenantId } from "@/lib/tenants.ts";

// Two-step sign-in for people in the main workspace: entering a code at sign-in, and turning it on or off in Settings → Security.
// Each action changes only the signed-in person's own authenticator.

export async function startWorkspaceTwoStepAction() {
  return startMfaEnrollAction();
}

type Result = { ok: false; error: string } | undefined;

async function check(input: { factorId?: string; code: string }): Promise<{ error: string } | { userId: string; enrolled: boolean }> {
  const code = String(input.code ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return { error: "Enter the 6-digit code from your authenticator app." };
  const { supabase } = await mfaState();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const verified = factors?.totp.find((f) => f.status === "verified");
  // With an authenticator already on, the code is always checked against it, so a password-only session can't add a second one.
  const factorId = factorToCheck(factors, input.factorId);
  if (!factorId) return { error: "Set up two-step sign-in first." };
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) return { error: "That code didn't match. Check the time on your phone and try the newest code." };
  return { userId: user.id, enrolled: !verified };
}

/** The sign-in step: a code, then on into the workspace. */
export async function verifyWorkspaceTwoStepAction(input: { factorId?: string; code: string }): Promise<Result> {
  const r = await check(input);
  if ("error" in r) return { ok: false, error: r.error };
  redirect("/");
}

/** First-time setup from Settings → Security. */
export async function enrollWorkspaceTwoStepAction(input: { factorId?: string; code: string }): Promise<Result> {
  const r = await check(input);
  if ("error" in r) return { ok: false, error: r.error };
  if (r.enrolled) await recordSecurityEvent(currentTenantId(), r.userId, "security_two_step_enabled");
  redirect("/settings/security?notice=" + encodeURIComponent("Two-step sign-in is on. You'll be asked for a code each time you sign in."));
}

/** Turning it off needs a code entered in this sign-in (the sign-in service enforces that too). */
export async function removeWorkspaceTwoStepAction(): Promise<void> {
  const { supabase, level } = await mfaState();
  const { data: { user } } = await supabase.auth.getUser();
  if (level !== "aal2") redirect("/settings/security?error=" + encodeURIComponent("Sign out and back in with your code first, then you can turn two-step sign-in off."));
  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const f of factors?.totp ?? []) {
    const { error } = await supabase.auth.mfa.unenroll({ factorId: f.id });
    if (error) redirect("/settings/security?error=" + encodeURIComponent("Two-step sign-in couldn't be turned off. Please try again."));
  }
  if (user) await recordSecurityEvent(currentTenantId(), user.id, "security_two_step_removed");
  redirect("/settings/security?notice=" + encodeURIComponent("Two-step sign-in is off."));
}
