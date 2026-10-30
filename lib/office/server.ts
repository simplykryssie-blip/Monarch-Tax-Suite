import "server-only";
import { renderEmailHtml, type EmailAction } from "./email-html.ts";
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { appOrigin, bureauWorkspace } from "../admin";
import { senderFor } from "../automation/engine.ts";
import { sanitizeError } from "../automation/sanitize.ts";
import { automationDeps } from "../automation/server";
import { heldBack } from "../forms/after.ts";
import { createClient } from "../supabase/server";
import { platformClient, tenantClient } from "../supabase/service";
import { rememberWorkspaceTenant } from "../workspace-session.ts";
import { featuresFor, type Permissions, type Role } from "./permissions.ts";
import type { OfficeDeps, OfficeMember } from "./service.ts";
import { SupabaseOfficeRepo } from "./supabase-repo.ts";

// Server wiring for the office area. Each request finds who is signed in, which office they belong to (one logged
// platform lookup, since the tenant isn't known until then), and asks for a two-step code if the person has turned it on.
// From there everything acts as that tenant, and the pages keep each member to their own office.

export const OFFICE_COOKIE = "monarch_office";

export function officeDeps(tenantId: string): OfficeDeps {
  return { repo: new SupabaseOfficeRepo(tenantClient(tenantId)) };
}

type MemberRow = OfficeMember & { tenant_id: string };

/** The member row for a signed-in account, in whichever tenant it is. */
export async function memberForUser(userId: string): Promise<MemberRow | null> {
  const { data } = await platformClient("office_member").from("office_members").select("*").eq("user_id", userId).maybeSingle();
  return (data as MemberRow | null) ?? null;
}

/** The invite a link's token hash points at, in whichever tenant it is. */
export async function memberForInviteHash(hash: string): Promise<MemberRow | null> {
  const { data } = await platformClient("office_invite").from("office_members").select("*").eq("invite_token_hash", hash).maybeSingle();
  return (data as MemberRow | null) ?? null;
}

/** Two-step sign-in state for the current session. */
export async function mfaState() {
  const supabase = await createClient();
  const [{ data: aal }, { data: factors }] = await Promise.all([supabase.auth.mfa.getAuthenticatorAssuranceLevel(), supabase.auth.mfa.listFactors()]);
  const verified = (factors?.totp ?? []).filter((f) => f.status === "verified");
  return { supabase, level: aal?.currentLevel ?? "aal1", hasFactor: verified.length > 0 };
}

export type OfficeContext = {
  userId: string;
  email: string;
  tenantId: string;
  role: Role;
  bureau: boolean;
  member: OfficeMember | null;
  office: { id: string; name: string };
  offices: { id: string; name: string }[];
  permissions: Permissions;
  features: ReturnType<typeof featuresFor>;
};

/**
 * Who is using the office area, and for which office. Not signed in → sign-in page; no office → an explanation;
 * no two-step sign-in yet → its setup. A bureau administrator can open any of the bureau's offices.
 */
export async function requireOffice(requestedOffice?: string): Promise<OfficeContext> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/office");
  const mfa = await mfaState();
  // Two-step sign-in is the person's choice: a code is asked for only once they have turned it on.
  if (mfa.hasFactor && mfa.level !== "aal2") redirect("/office/mfa");

  const bureauTenant = await bureauWorkspace(user.id);
  if (bureauTenant) {
    // The office area does not pass the workspace gate, so it tells the rest of the request which workspace this is.
    rememberWorkspaceTenant(bureauTenant);
    const tenantId = bureauTenant;
    const offices = (await officeDeps(tenantId).repo.listOffices()).filter((o) => !o.archived);
    const wanted = requestedOffice ?? (await cookies()).get(OFFICE_COOKIE)?.value;
    const office = offices.find((o) => o.id === wanted) ?? offices[0];
    if (!office) redirect("/efin/new?error=" + encodeURIComponent("Add a firm first; each firm is an office."));
    return { userId: user.id, email: user.email ?? "", tenantId, role: "bureau", bureau: true, member: null, office, offices, permissions: {}, features: featuresFor("bureau", {}) };
  }

  const member = await memberForUser(user.id);
  if (!member) redirect("/login?error=" + encodeURIComponent("This account isn't part of an office. Ask your service bureau for an invite."));
  if (member.status !== "active") redirect("/login?error=" + encodeURIComponent("This account's office access is suspended. Contact your service bureau."));
  const deps = officeDeps(member.tenant_id);
  const office = (await deps.repo.listOffices()).find((o) => o.id === member.organization_id);
  if (!office || office.archived) redirect("/login?error=" + encodeURIComponent("This account's office is no longer active. Contact your service bureau."));
  const role: Role = member.role === "ero" ? "ero" : "preparer";
  // Recorded at most once an hour, so the team page can show who's been active.
  if (!member.last_seen_at || Date.now() - Date.parse(member.last_seen_at) > 3_600_000) {
    await deps.repo.updateMember(member.id, { last_seen_at: new Date().toISOString() }).catch(() => undefined);
  }
  return {
    userId: user.id, email: user.email ?? "", tenantId: member.tenant_id, role, bureau: false, member, office: { id: office.id, name: office.name }, offices: [{ id: office.id, name: office.name }],
    permissions: member.permissions ?? {}, features: featuresFor(role, member.permissions ?? {}),
  };
}

/** Sends the invite email from the tenant's sending address. Returns null when sent, or why not. */
export async function sendOfficeEmail(tenantId: string, to: string, mail: { subject: string; text: string; action?: EmailAction }): Promise<string | null> {
  const auto = automationDeps(tenantId);
  if (auto.config.env !== "production" && !auto.config.testRecipients.map((r) => r.toLowerCase()).includes(to.toLowerCase())) return heldBack(auto, to);
  let sender;
  try {
    sender = await senderFor(auto, null);
  } catch (e) {
    return sanitizeError(e, 200);
  }
  const html = renderEmailHtml(mail.text, mail.action);
  const result = await auto.email.send({ ...sender, to, subject: mail.subject, text: mail.text, html, idempotencyKey: `office-invite:${createHash("sha256").update(to + mail.text).digest("hex").slice(0, 32)}` });
  return result.ok ? null : sanitizeError(result.message, 200);
}

export async function inviteLink(token: string) {
  return `${(await appOrigin()).replace(/\/$/, "")}/office/invite/${token}`;
}
