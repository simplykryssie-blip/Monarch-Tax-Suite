"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { createClient } from "@/lib/supabase/server";
import { platformClient } from "@/lib/supabase/service";
import { memberForUser } from "@/lib/office/server";
import { acceptInvite, inviteFor } from "@/lib/practice/service.ts";
import { mfaState, practiceMemberForInviteHash, practiceMemberForUser, practicePlatform, practiceRepo } from "@/lib/practice/server";
import { startMfaEnrollAction } from "@/app/office/actions";

// The independent PTIN holder's sign-in steps: accept the invite, then two-step sign-in. They mirror the office area's.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
type InviteResult = { ok: false; error: string } | undefined;
const failure = (e: unknown) => {
  if (e instanceof ValidationError) return e.message;
  console.error(`practice action failed: ${sanitizeError(e, 200)}`);
  if (/relation|schema cache|does not exist/i.test(e instanceof Error ? e.message : "")) return "The PTIN workspace isn't installed yet. Apply the practice access migration first.";
  return "That did not work. Nothing was changed. Please try again.";
};

/** Accepting an invite as a new account: create it with the chosen password, sign in, link it, then two-step setup. */
export async function acceptPracticeNewAccountAction(token: string, password: string): Promise<InviteResult> {
  try {
    const row = await inviteFor(token, practiceMemberForInviteHash);
    if (!row) return { ok: false, error: "This invite link has expired or was already used. Ask for a new invite." };
    if (typeof password !== "string" || password.length < 12 || password.length > 128) return { ok: false, error: "Choose a password of at least 12 characters." };
    const created = await platformClient("practice_invite").auth.admin.createUser({ email: row.email, password, email_confirm: true, user_metadata: { full_name: row.full_name } });
    if (created.error) {
      if (/already|registered|exists/i.test(created.error.message)) return { ok: false, error: `An account with ${row.email} already exists. Sign in with it, then open this link again.` };
      return { ok: false, error: "The account couldn't be created. Please try again." };
    }
    const supabase = await createClient();
    const signed = await supabase.auth.signInWithPassword({ email: row.email, password });
    if (signed.error || !signed.data.user) return { ok: false, error: "Your account was created, but signing in failed. Sign in with your new password, then open this link again." };
    await acceptInvite({ repo: practiceRepo(row.tenant_id) }, practicePlatform(), row.tenant_id, row, signed.data.user.id, signed.data.user.email ?? "");
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: failure(e) };
  }
  redirect("/practice/mfa");
}

/** Accepting an invite while already signed in with the invited email. */
export async function acceptPracticeSignedInAction(token: string): Promise<InviteResult> {
  try {
    const row = await inviteFor(token, practiceMemberForInviteHash);
    if (!row) return { ok: false, error: "This invite link has expired or was already used. Ask for a new invite." };
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Sign in first." };
    // One sign-in belongs to one workspace or office.
    if ((await practiceMemberForUser(user.id)) || (await memberForUser(user.id))) return { ok: false, error: "This account already belongs to a workspace or office. Sign in with a different email to accept this invite." };
    await acceptInvite({ repo: practiceRepo(row.tenant_id) }, practicePlatform(), row.tenant_id, row, user.id, user.email ?? "");
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: failure(e) };
  }
  redirect("/practice/mfa");
}

export async function startPracticeMfaAction() {
  return startMfaEnrollAction();
}

/** Checks the code; the workspace's audit history records the step. */
export async function verifyPracticeMfaAction(input: { factorId?: string; code: string }): Promise<{ ok: false; error: string } | undefined> {
  const code = String(input.code ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return { ok: false, error: "Enter the 6-digit code from your authenticator app." };
  const { supabase } = await mfaState();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factorId = input.factorId && UUID.test(input.factorId) ? input.factorId : factors?.totp.find((f) => f.status === "verified")?.id;
  if (!factorId) return { ok: false, error: "Set up two-step sign-in first." };
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) return { ok: false, error: "That code didn't match. Check the time on your phone and try the newest code." };
  const { data: { user } } = await supabase.auth.getUser();
  const member = user ? await practiceMemberForUser(user.id) : null;
  if (member) await practiceRepo(member.tenant_id).addAudit({ actor_id: user!.id, action: input.factorId ? "mfa_enrolled" : "mfa_verified", subject_type: "practice_member", subject_id: member.id }).catch(() => undefined);
  redirect("/practice");
}

/** "Skip for now": two-step sign-in is optional for a holder. Recorded, then straight into the workspace. */
export async function skipPracticeMfaAction(): Promise<void> {
  const { supabase } = await mfaState();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/practice");
  const member = await practiceMemberForUser(user.id);
  if (member) await practiceRepo(member.tenant_id).addAudit({ actor_id: user.id, action: "mfa_skipped", subject_type: "practice_member", subject_id: member.id }).catch(() => undefined);
  redirect("/practice");
}
