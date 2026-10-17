import "server-only";
import { redirect } from "next/navigation";
import { appOrigin } from "../admin";
import { createClient } from "../supabase/server";
import { platformClient, tenantClient } from "../supabase/service";
import { mfaState, sendOfficeEmail } from "../office/server";
import { practiceMfaGate } from "./mfa.ts";
import type { PracticeMember, PracticeRepo } from "./service.ts";
import { SupabasePracticePlatform, SupabasePracticeRepo } from "./supabase-repo.ts";

// Server wiring for an independent PTIN holder's workspace. Each request finds who is signed in and which workspace
// they belong to (one logged platform lookup, since the tenant isn't known until then), requires two-step sign-in,
// and checks the tenant really is a ptin-tier workspace. From there everything acts as that tenant.

export function practiceRepo(tenantId: string): PracticeRepo {
  return new SupabasePracticeRepo(tenantClient(tenantId));
}
export function practicePlatform() {
  return new SupabasePracticePlatform(platformClient("practice_provision"));
}

type MemberRow = PracticeMember & { tenant_id: string };

export async function practiceMemberForUser(userId: string): Promise<MemberRow | null> {
  const { data } = await platformClient("practice_member").from("practice_members").select("*").eq("user_id", userId).maybeSingle();
  return (data as MemberRow | null) ?? null;
}
export async function practiceMemberForInviteHash(hash: string): Promise<MemberRow | null> {
  const { data } = await platformClient("practice_invite").from("practice_members").select("*").eq("invite_token_hash", hash).maybeSingle();
  return (data as MemberRow | null) ?? null;
}

export type PracticeContext = { userId: string; email: string; tenantId: string; member: PracticeMember; workspace: string };

/** Who is using the workspace. Not signed in → sign-in; no workspace → an explanation; no two-step sign-in → its setup. */
export async function requirePractice(): Promise<PracticeContext> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/practice");
  // Two-step sign-in is the holder's choice: it is enforced only for a holder who turned it on.
  if (practiceMfaGate(await mfaState()) === "verify") redirect("/practice/mfa");
  const member = await practiceMemberForUser(user.id);
  if (!member) redirect("/login?error=" + encodeURIComponent("This account doesn't have a PTIN workspace."));
  if (member.status !== "active") redirect("/login?error=" + encodeURIComponent("This workspace is suspended. Contact the platform administrator."));
  // The tier is read from the tenant itself; a workspace is only ever a ptin-tier tenant.
  const { data: tenant } = await platformClient("practice_member").from("tenants").select("name, tier").eq("id", member.tenant_id).maybeSingle();
  if (!tenant || (tenant as { tier: string }).tier !== "ptin") redirect("/login?error=" + encodeURIComponent("This account doesn't have a PTIN workspace."));
  const repo = practiceRepo(member.tenant_id);
  // Recorded at most once an hour.
  if (!member.last_seen_at || Date.now() - Date.parse(member.last_seen_at) > 3_600_000) {
    await repo.updateMember(member.id, { last_seen_at: new Date().toISOString() }).catch(() => undefined);
  }
  return { userId: user.id, email: user.email ?? "", tenantId: member.tenant_id, member, workspace: (tenant as { name: string }).name };
}

export async function practiceInviteLink(token: string) {
  return `${(await appOrigin()).replace(/\/$/, "")}/practice/invite/${token}`;
}
export { mfaState, sendOfficeEmail as sendPracticeEmail };
