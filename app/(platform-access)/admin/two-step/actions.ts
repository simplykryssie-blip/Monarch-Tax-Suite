"use server";

import { redirect } from "next/navigation";
import { factorToCheck } from "@/lib/admin-two-step.ts";
import { isAdminUser } from "@/lib/admin";
import { startMfaEnrollAction } from "@/app/office/actions";
import { mfaState } from "@/lib/office/server";
import { recordPlatformAction } from "@/lib/platform-audit-server";

export async function startAdminTwoStepAction() {
  return startMfaEnrollAction();
}

/**
 * Checks the code. With an authenticator already set up, the code is always checked against that one: a password-only
 * session cannot enroll a second authenticator and use it to get past this step. First-time setup checks the one just made.
 */
export async function verifyAdminTwoStepAction(input: { factorId?: string; code: string }): Promise<{ ok: false; error: string } | undefined> {
  const code = String(input.code ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return { ok: false, error: "Enter the 6-digit code from your authenticator app." };
  const { supabase } = await mfaState();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/two-step");
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const verified = factors?.totp.find((f) => f.status === "verified");
  const factorId = factorToCheck(factors, input.factorId);
  if (!factorId) return { ok: false, error: "Set up two-step sign-in first." };
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) return { ok: false, error: "That code didn't match. Check the time on your phone and try the newest code." };
  if (!verified) await recordPlatformAction(user.id, "platform_two_step_enrolled", { subjectType: "user", subjectId: user.id });
  // An account that is not (yet) a platform administrator finishes on the confirmation; an administrator goes on in.
  redirect((await isAdminUser(user.id)) ? "/admin/workspaces" : "/admin/two-step");
}
