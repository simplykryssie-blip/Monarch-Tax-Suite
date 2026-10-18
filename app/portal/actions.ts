"use server";

import { cookies } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { createClient } from "@/lib/supabase/server";
import { platformClient } from "@/lib/supabase/service";
import { acceptPortalInvite, portalInviteFor } from "@/lib/portal/service.ts";
import { isOfficeChoice, mfaState, PORTAL_COOKIE, portalMemberForInviteHash, portalMemberRepo, portalMembershipsForUser } from "@/lib/portal/server";
import { startMfaEnrollAction } from "@/app/office/actions";

// The client's sign-in steps: accept the invite (new account or the account they already have), choose an office when
// they are a client of several, and the optional two-step sign-in.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
type Result = { ok: false; error: string } | undefined;
const failure = (e: unknown) => {
  if (e instanceof ValidationError) return e.message;
  console.error(`portal action failed: ${sanitizeError(e, 200)}`);
  if (/relation|schema cache|does not exist/i.test(e instanceof Error ? e.message : "")) return "The client portal isn't installed yet. Apply the portal migration first.";
  return "That did not work. Nothing was changed. Please try again.";
};

/** A new account with the invited email and the chosen password, signed in, linked to the invite. */
export async function acceptPortalNewAccountAction(token: string, password: string): Promise<Result> {
  try {
    const row = await portalInviteFor(token, portalMemberForInviteHash);
    if (!row) return { ok: false, error: "This invite link has expired or was already used. Ask your tax office for a new one." };
    if (typeof password !== "string" || password.length < 12 || password.length > 128) return { ok: false, error: "Choose a password of at least 12 characters." };
    const created = await platformClient("portal_invite").auth.admin.createUser({ email: row.email, password, email_confirm: true, user_metadata: { full_name: row.full_name } });
    if (created.error) {
      if (/already|registered|exists/i.test(created.error.message)) return { ok: false, error: `An account with ${row.email} already exists. Sign in with it, then open this link again.` };
      return { ok: false, error: "The account couldn't be created. Please try again." };
    }
    const supabase = await createClient();
    const signed = await supabase.auth.signInWithPassword({ email: row.email, password });
    if (signed.error || !signed.data.user) return { ok: false, error: "Your account was created, but signing in failed. Sign in with your new password, then open this link again." };
    await acceptPortalInvite({ repo: portalMemberRepo(row.tenant_id) }, row, signed.data.user.id, signed.data.user.email ?? "");
    (await cookies()).set(PORTAL_COOKIE, row.tenant_id, { httpOnly: true, sameSite: "lax", secure: true, path: "/portal" });
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: failure(e) };
  }
  redirect("/portal");
}

/** Accepting while already signed in with the invited email (a client of another office, adding this one). */
export async function acceptPortalSignedInAction(token: string): Promise<Result> {
  try {
    const row = await portalInviteFor(token, portalMemberForInviteHash);
    if (!row) return { ok: false, error: "This invite link has expired or was already used. Ask your tax office for a new one." };
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Sign in first." };
    await acceptPortalInvite({ repo: portalMemberRepo(row.tenant_id) }, row, user.id, user.email ?? "");
    (await cookies()).set(PORTAL_COOKIE, row.tenant_id, { httpOnly: true, sameSite: "lax", secure: true, path: "/portal" });
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: failure(e) };
  }
  redirect("/portal");
}

/** Switches which office's portal is open. Only an office the account is a client of can be chosen. */
export async function chooseOfficeAction(formData: FormData): Promise<void> {
  const wanted = formData.get("office");
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) redirect("/login?next=/portal");
  if (isOfficeChoice(wanted) && (await portalMembershipsForUser(user.id)).some((m) => m.tenant_id === wanted)) {
    (await cookies()).set(PORTAL_COOKIE, wanted, { httpOnly: true, sameSite: "lax", secure: true, path: "/portal" });
  }
  redirect("/portal");
}

export async function startPortalMfaAction() {
  return startMfaEnrollAction();
}

export async function verifyPortalMfaAction(input: { factorId?: string; code: string }): Promise<Result> {
  const code = String(input.code ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return { ok: false, error: "Enter the 6-digit code from your authenticator app." };
  const { supabase } = await mfaState();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factorId = input.factorId && UUID.test(input.factorId) ? input.factorId : factors?.totp.find((f) => f.status === "verified")?.id;
  if (!factorId) return { ok: false, error: "Set up two-step sign-in first." };
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) return { ok: false, error: "That code didn't match. Check the time on your phone and try the newest code." };
  redirect("/portal");
}

export async function skipPortalMfaAction(): Promise<void> {
  redirect("/portal");
}
