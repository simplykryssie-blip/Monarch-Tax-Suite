"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { requireSection } from "@/lib/tier-server";
import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { PLATFORM } from "@/lib/platform-brand";
import { currentTenantId } from "@/lib/tenants";
import { provisionWorkspace, reissueInvite, setSuspended, withdrawInvite } from "@/lib/practice/service.ts";
import { practiceInviteLink, practicePlatform, practiceRepo, sendPracticeEmail } from "@/lib/practice/server";
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
  const problem = await sendPracticeEmail(currentTenantId(), member.email, inviteEmail({ brand: PLATFORM.name, workspace, name: member.full_name, link }));
  await practiceRepo(tenantId).addAudit({ actor_id: adminUserId, action: problem ? "invite_email_failed" : "invite_emailed", subject_type: "practice_member", subject_id: member.id, detail: problem ? { reason: problem.slice(0, 200) } : {} });
  revalidatePath("/offices/holders");
  return problem
    ? { ok: true, message: `Workspace created, but the email wasn't sent: ${problem} Share this one-time link with ${member.full_name} yourself.`, link }
    : { ok: true, message: `Workspace created. The invite was emailed to ${member.email}; the link works for 7 days.`, link: null };
}

export async function createWorkspaceAction(input: { workspaceName: string; fullName: string; email: string }): Promise<HolderResult> {
  try {
    const admin = await requireSection("bureau");
    const made = await provisionWorkspace(practicePlatform(), practiceRepo, admin.userId, { workspaceName: String(input.workspaceName ?? ""), fullName: String(input.fullName ?? ""), email: String(input.email ?? "") });
    return await send(made.tenantId, String(input.workspaceName || input.fullName), made.member, made.token, admin.userId);
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: failure(e) };
  }
}

export async function resendInviteAction(input: { tenantId: string; memberId: string; workspace: string }): Promise<HolderResult> {
  try {
    const admin = await requireSection("bureau");
    if (!UUID.test(input.tenantId) || !UUID.test(input.memberId)) throw new ValidationError("Not found.");
    const { member, token } = await reissueInvite({ repo: practiceRepo(input.tenantId) }, admin.userId, input.memberId);
    return await send(input.tenantId, input.workspace, member, token, admin.userId);
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: failure(e) };
  }
}

export async function holderAccessAction(input: { tenantId: string; memberId: string; change: "withdraw" | "suspend" | "reactivate" }): Promise<{ ok: boolean; error?: string }> {
  try {
    const admin = await requireSection("bureau");
    if (!UUID.test(input.tenantId) || !UUID.test(input.memberId)) throw new ValidationError("Not found.");
    const deps = { repo: practiceRepo(input.tenantId) };
    if (input.change === "withdraw") await withdrawInvite(deps, admin.userId, input.memberId);
    else await setSuspended(deps, admin.userId, input.memberId, input.change === "suspend");
    revalidatePath("/offices/holders");
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: failure(e) };
  }
}
