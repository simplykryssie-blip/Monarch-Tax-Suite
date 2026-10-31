"use server";

import { cookies } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { currentTenantId } from "@/lib/tenants";
import { revalidatePath } from "next/cache";
import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { createClient } from "@/lib/supabase/server";
import { platformClient } from "@/lib/supabase/service";
import { acceptInvite, cancelInvite, invite, inviteEmail, inviteFor, setPermissions, setSuspended, type Actor } from "@/lib/office/service.ts";
import { inviteLink, memberForInviteHash, memberForUser, mfaState, OFFICE_COOKIE, officeDeps, requireOffice, sendOfficeEmail } from "@/lib/office/server";
import { documentDeps } from "@/lib/documents/server";

// Office area actions. Each one re-checks who is signed in, that two-step sign-in is done, and that they may act on
// this office; the tenant-scoped client keeps everything inside their tenant.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const str = (form: FormData, k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string) : "");
type FormResult = { error: string; field?: string } | undefined;
const failure = (e: unknown) => {
  if (e instanceof ValidationError) return e.message;
  console.error(`office action failed: ${sanitizeError(e, 200)}`);
  if (/relation|schema cache|does not exist/i.test(e instanceof Error ? e.message : "")) return "The office area isn't installed yet. Apply the office access migration first.";
  return "That did not work. Nothing was changed. Please try again.";
};
const to = (path: string, key: "notice" | "error", message: string) => `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(message)}`;

async function actor(): Promise<{ ctx: Awaited<ReturnType<typeof requireOffice>>; who: Actor }> {
  const ctx = await requireOffice();
  return { ctx, who: { userId: ctx.userId, bureau: ctx.bureau, member: ctx.member } };
}

async function act(back: string, fn: () => Promise<string>): Promise<FormResult> {
  let target: string;
  try {
    target = to(back, "notice", await fn());
  } catch (e) {
    unstable_rethrow(e);
    return { error: failure(e) };
  }
  revalidatePath("/office", "layout");
  redirect(target);
}

export type InviteSent = { ok: true; message: string; link: string | null } | { ok: false; error: string };

/**
 * Sends an invite and emails it. The link itself is never put in a page address; if the email couldn't go, it's
 * returned to the inviter's screen to share by hand.
 */
async function sendInvite(tenantId: string, officeName: string, who: Actor, input: { officeId: string; role: "ero" | "preparer"; email: string; fullName: string }): Promise<InviteSent> {
  const deps = officeDeps(tenantId);
  const { member, token } = await invite(deps, who, input);
  const link = await inviteLink(token);
  const brand = (await documentDeps(tenantId).repo.getProfile().catch(() => null))?.display_name || "Your office";
  const problem = await sendOfficeEmail(tenantId, member.email, inviteEmail({ brand, office: officeName, name: member.full_name, role: input.role, link }));
  await deps.repo.addEvent({ organization_id: input.officeId, member_id: member.id, action: problem ? "invite_email_failed" : "invite_emailed", actor_id: who.userId, detail: problem ? { reason: problem.slice(0, 200) } : {} });
  revalidatePath("/office", "layout");
  revalidatePath("/offices", "layout");
  return problem
    ? { ok: true, message: `Invite created, but the email wasn't sent: ${problem} Share this one-time link with ${member.full_name} yourself.`, link }
    : { ok: true, message: `Invite emailed to ${member.email}. The link works for 7 days.`, link: null };
}

export async function invitePreparerAction(input: { email: string; fullName: string }): Promise<InviteSent> {
  try {
    const { ctx, who } = await actor();
    return await sendInvite(ctx.tenantId, ctx.office.name, who, { officeId: ctx.office.id, role: "preparer", email: String(input.email ?? ""), fullName: String(input.fullName ?? "") });
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: failure(e) };
  }
}

/** The bureau invites an ERO (or a preparer) to any of its offices, from My Service Bureau → Office access. */
export async function bureauInviteAction(input: { officeId: string; role: string; email: string; fullName: string }): Promise<InviteSent> {
  try {
    const admin = await requireAdmin();
    const tenantId = currentTenantId();
    if (!UUID.test(String(input.officeId))) throw new ValidationError("Choose the office.");
    const office = (await officeDeps(tenantId).repo.listOffices()).find((o) => o.id === input.officeId);
    if (!office) throw new ValidationError("That office wasn't found.");
    return await sendInvite(tenantId, office.name, { userId: admin.userId, bureau: true }, { officeId: office.id, role: input.role === "ero" ? "ero" : "preparer", email: String(input.email ?? ""), fullName: String(input.fullName ?? "") });
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: failure(e) };
  }
}

export async function setPermissionsAction(form: FormData): Promise<FormResult> {
  return act("/office/team", async () => {
    const id = str(form, "id");
    if (!UUID.test(id)) throw new ValidationError("Not found.");
    const { ctx, who } = await actor();
    const raw: Record<string, unknown> = {};
    for (const k of form.getAll("feature")) if (typeof k === "string") raw[k] = true;
    for (const k of form.getAll("known")) if (typeof k === "string" && raw[k] === undefined) raw[k] = false;
    await setPermissions(officeDeps(ctx.tenantId), who, id, raw);
    return "Permissions saved.";
  });
}

export async function suspendAction(form: FormData): Promise<FormResult> {
  return act("/office/team", async () => {
    const id = str(form, "id");
    if (!UUID.test(id)) throw new ValidationError("Not found.");
    const { ctx, who } = await actor();
    const on = str(form, "suspend") === "yes";
    await setSuspended(officeDeps(ctx.tenantId), who, id, on);
    return on ? "Suspended. They can't sign in to the office until you reactivate them." : "Reactivated.";
  });
}

export async function cancelInviteAction(form: FormData): Promise<FormResult> {
  return act("/office/team", async () => {
    const id = str(form, "id");
    if (!UUID.test(id)) throw new ValidationError("Not found.");
    const { ctx, who } = await actor();
    await cancelInvite(officeDeps(ctx.tenantId), who, id);
    return "Invite withdrawn.";
  });
}

/** A bureau administrator picks which office to open. */
export async function chooseOfficeAction(form: FormData) {
  const id = str(form, "office_id");
  if (UUID.test(id)) (await cookies()).set(OFFICE_COOKIE, id, { httpOnly: true, sameSite: "lax", secure: true, path: "/office", maxAge: 60 * 60 * 24 * 30 });
  redirect("/office");
}

// ------------------------------------------------------------------ invites

type InviteResult = { ok: false; error: string } | undefined;

/** Accepting an invite as a new account: create it with the chosen password, sign in, link it, then two-step setup. */
export async function acceptNewAccountAction(token: string, password: string): Promise<InviteResult> {
  try {
    const row = await inviteFor(token, memberForInviteHash);
    if (!row) return { ok: false, error: "This invite link has expired or was already used. Ask for a new invite." };
    if (typeof password !== "string" || password.length < 12 || password.length > 128) return { ok: false, error: "Choose a password of at least 12 characters." };
    const created = await platformClient("office_invite").auth.admin.createUser({ email: row.email, password, email_confirm: true, user_metadata: { full_name: row.full_name } });
    if (created.error) {
      if (/already|registered|exists/i.test(created.error.message)) return { ok: false, error: `An account with ${row.email} already exists. Sign in with it, then open this link again.` };
      return { ok: false, error: "The account couldn't be created. Please try again." };
    }
    const supabase = await createClient();
    const signed = await supabase.auth.signInWithPassword({ email: row.email, password });
    if (signed.error || !signed.data.user) return { ok: false, error: "Your account was created, but signing in failed. Sign in with your new password, then open this link again." };
    await acceptInvite(officeDeps(row.tenant_id), row, signed.data.user.id, signed.data.user.email ?? "");
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: failure(e) };
  }
  redirect("/office/mfa");
}

/** Accepting an invite while already signed in with the invited email. */
export async function acceptSignedInAction(token: string): Promise<InviteResult> {
  try {
    const row = await inviteFor(token, memberForInviteHash);
    if (!row) return { ok: false, error: "This invite link has expired or was already used. Ask for a new invite." };
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Sign in first." };
    if (await memberForUser(user.id)) return { ok: false, error: "This account already belongs to an office. Sign in with a different email to accept this invite." };
    await acceptInvite(officeDeps(row.tenant_id), row, user.id, user.email ?? "");
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: failure(e) };
  }
  redirect("/office/mfa");
}

// ------------------------------------------------------------------ two-step sign-in

export async function startMfaEnrollAction(): Promise<{ ok: true; factorId: string; qr: string; secret: string } | { ok: false; error: string }> {
  const { supabase, hasFactor } = await mfaState();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };
  if (hasFactor) return { ok: false, error: "Two-step sign-in is already set up. Enter a code from your app." };
  // A half-finished setup from an earlier visit is replaced.
  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const f of factors?.all ?? []) if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}` });
  if (error || !data) return { ok: false, error: "Two-step sign-in couldn't be started. Please try again." };
  return { ok: true, factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

/** "Skip for now": two-step sign-in is recommended, not required. Recorded for an office member, then straight into the office. */
export async function skipMfaAction(): Promise<void> {
  const { supabase } = await mfaState();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/office");
  const member = await memberForUser(user.id);
  if (member) await officeDeps(member.tenant_id).repo.addEvent({ organization_id: member.organization_id, member_id: member.id, action: "mfa_skipped", actor_id: user.id, detail: {} }).catch(() => undefined);
  redirect("/office");
}

export async function verifyMfaAction(input: { factorId?: string; code: string }): Promise<{ ok: false; error: string } | undefined> {
  const code = String(input.code ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return { ok: false, error: "Enter the 6-digit code from your authenticator app." };
  const { supabase } = await mfaState();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factorId = input.factorId && UUID.test(input.factorId) ? input.factorId : factors?.totp.find((f) => f.status === "verified")?.id;
  if (!factorId) return { ok: false, error: "Set up two-step sign-in first." };
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) return { ok: false, error: "That code didn't match. Check the time on your phone and try the newest code." };
  const { data: { user } } = await supabase.auth.getUser();
  const member = user ? await memberForUser(user.id) : null;
  if (member) await officeDeps(member.tenant_id).repo.addEvent({ organization_id: member.organization_id, member_id: member.id, action: input.factorId ? "mfa_enrolled" : "mfa_verified", actor_id: user!.id, detail: {} }).catch(() => undefined);
  redirect("/office");
}
