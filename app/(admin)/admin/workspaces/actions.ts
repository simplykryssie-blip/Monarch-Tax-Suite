"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/admin";
import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { PLATFORM } from "@/lib/platform-brand";
import { provisionWorkspace, reissueInvite, setSuspended, withdrawInvite } from "@/lib/practice/service.ts";
import { practiceInviteLink, practicePlatform, practiceRepo } from "@/lib/practice/server";
import { sendPlatformEmail } from "@/lib/platform-mail-server";
import { recordPlatformAction } from "@/lib/platform-audit-server";
import { inviteEmail } from "@/lib/practice/service.ts";

// Platform administrator only: create an independent PTIN holder's workspace and invite its owner. There is no
// self-serve signup in Phase 4.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export type HolderResult = { ok: true; message: string; link: string | null } | { ok: false; error: string };
const failure = (e: unknown) => {
  if (e instanceof ValidationError) return e.message;
  console.error(`practice admin action failed: ${sanitizeError(e, 200)}`);
  if (/relation|schema cache|does not exist/i.test(e instanceof Error ? e.message : "")) return "PTIN workspaces aren't installed yet. Apply the practice access migration first.";
  return "That did not work. Nothing was changed. Please try again.";
};

/** Emails the link from the platform's own sending address. If it can't go, the link is returned to share by hand. */
async function send(tenantId: string, workspace: string, member: { id: string; email: string; full_name: string }, token: string, adminUserId: string): Promise<HolderResult> {
  const link = await practiceInviteLink(token);
  const problem = await sendPlatformEmail(member.email, inviteEmail({ brand: PLATFORM.name, workspace, name: member.full_name, link }));
  await practiceRepo(tenantId).addAudit({ actor_id: adminUserId, action: problem ? "invite_email_failed" : "invite_emailed", subject_type: "practice_member", subject_id: member.id, detail: problem ? { reason: problem.slice(0, 200) } : {} });
  revalidatePath("/admin/workspaces");
  return problem
    ? { ok: true, message: `Workspace created, but the email wasn't sent: ${problem} Share this one-time link with ${member.full_name} yourself.`, link }
    : { ok: true, message: `Workspace created. The invite was emailed to ${member.email}; the link works for 7 days.`, link: null };
}

export async function createWorkspaceAction(input: { workspaceName: string; fullName: string; email: string }): Promise<HolderResult> {
  try {
    const admin = await requirePlatformAdmin();
    const made = await provisionWorkspace(practicePlatform(), practiceRepo, admin.userId, { workspaceName: String(input.workspaceName ?? ""), fullName: String(input.fullName ?? ""), email: String(input.email ?? "") });
    await recordPlatformAction(admin.userId, "platform_workspace_created", { tenantId: made.tenantId, subjectType: "practice_member", subjectId: made.member.id, detail: { workspace: String(input.workspaceName || input.fullName) } });
    return await send(made.tenantId, String(input.workspaceName || input.fullName), made.member, made.token, admin.userId);
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: failure(e) };
  }
}

export async function resendInviteAction(input: { tenantId: string; memberId: string; workspace: string }): Promise<HolderResult> {
  try {
    const admin = await requirePlatformAdmin();
    if (!UUID.test(input.tenantId) || !UUID.test(input.memberId)) throw new ValidationError("Not found.");
    const { member, token } = await reissueInvite({ repo: practiceRepo(input.tenantId) }, admin.userId, input.memberId);
    await recordPlatformAction(admin.userId, "platform_invite_resent", { tenantId: input.tenantId, subjectType: "practice_member", subjectId: member.id });
    return await send(input.tenantId, input.workspace, member, token, admin.userId);
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: failure(e) };
  }
}

export async function holderAccessAction(input: { tenantId: string; memberId: string; change: "withdraw" | "suspend" | "reactivate" }): Promise<{ ok: boolean; error?: string }> {
  try {
    const admin = await requirePlatformAdmin();
    if (!UUID.test(input.tenantId) || !UUID.test(input.memberId)) throw new ValidationError("Not found.");
    const deps = { repo: practiceRepo(input.tenantId) };
    if (input.change === "withdraw") await withdrawInvite(deps, admin.userId, input.memberId);
    else await setSuspended(deps, admin.userId, input.memberId, input.change === "suspend");
    await recordPlatformAction(admin.userId, "platform_access_changed", { tenantId: input.tenantId, subjectType: "practice_member", subjectId: input.memberId, detail: { change: input.change } });
    revalidatePath("/admin/workspaces");
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: failure(e) };
  }
}
