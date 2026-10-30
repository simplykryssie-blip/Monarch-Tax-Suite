import { randomBytes } from "node:crypto";
import { ValidationError } from "../commerce/validation.ts";
import { cleanLabel, labelFromName } from "../sites/domains.ts";
import { cleanToken, EMAIL, hashToken, INVITE_DAYS, newToken } from "../office/service.ts";

// An independent PTIN holder's own workspace: the platform administrator creates the ptin-tier tenant and invites its
// owner; the owner accepts, sets a password and turns on two-step sign-in. Nothing here is self-serve (that comes with
// the pre-launch package). Every step is written to the tenant's audit history.

export type PracticeMember = {
  id: string; role: "owner"; email: string; full_name: string; user_id: string | null;
  status: "invited" | "active" | "suspended"; invite_token_hash: string | null; invite_expires_at: string | null;
  invited_by: string | null; accepted_at: string | null; last_seen_at: string | null; created_at: string;
};
export type AuditInput = { actor_id: string | null; action: string; subject_type?: string | null; subject_id?: string | null; detail?: Record<string, unknown> };

/** One workspace's own rows (a tenant-scoped client). */
export interface PracticeRepo {
  listMembers(): Promise<PracticeMember[]>;
  getMember(id: string): Promise<PracticeMember | null>;
  insertMember(input: { email: string; full_name: string; invite_token_hash: string; invite_expires_at: string; invited_by: string | null }): Promise<PracticeMember>;
  updateMember(id: string, patch: Partial<PracticeMember>): Promise<PracticeMember>;
  addAudit(input: AuditInput): Promise<void>;
}
/** What only the platform may do: create the tenant, and record that an account belongs to it. */
export interface PracticePlatform {
  createTenant(input: { slug: string; name: string; tier: "ptin" }): Promise<{ id: string }>;
  addTenantMember(tenantId: string, userId: string, role: "owner"): Promise<void>;
}
export type PracticeDeps = { repo: PracticeRepo; now?: () => Date };
const nowOf = (d: { now?: () => Date }) => (d.now ? d.now() : new Date());
const fail = (m: string): never => { throw new ValidationError(m); };

export const slugFor = (name: string, rand: () => string = () => randomBytes(3).toString("hex")) =>
  `ptin-${name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "workspace"}-${rand()}`;

/**
 * The addresses a signed-up workspace may take, best first. The workspace's own name, with no extras, when it is free and
 * allowed; otherwise the name plus a short mark taken from its payment. The mark is the same on every retry, so a repeated
 * delivery lands on the same workspace, and two workspaces with the same name can never share an address.
 */
export function signupSlugs(name: string, mark: string): string[] {
  const raw = labelFromName(name);
  const base = (() => { try { return cleanLabel(raw); } catch { return null; } })();
  const marked = `${raw.slice(0, 39 - mark.length - 1).replace(/-+$/g, "")}-${mark}`;
  return base ? [base, marked] : [marked];
}

function cleanInput(input: { workspaceName: string; email: string; fullName: string }) {
  const email = input.email.trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) fail("Enter a valid email address.");
  const fullName = input.fullName.replace(/\s+/g, " ").trim();
  if (fullName.length < 2 || fullName.length > 200) fail("Enter the PTIN holder's name.");
  const workspaceName = input.workspaceName.replace(/\s+/g, " ").trim() || fullName;
  if (workspaceName.length < 2 || workspaceName.length > 120) fail("The workspace name must be 2 to 120 characters.");
  return { email, fullName, workspaceName };
}
const inviteFields = (deps: { now?: () => Date }, token: string, invitedBy: string | null) => ({
  invite_token_hash: hashToken(token), invite_expires_at: new Date(nowOf(deps).getTime() + INVITE_DAYS * 86_400_000).toISOString(), invited_by: invitedBy,
});

/**
 * Platform administrator: creates an independent PTIN holder's workspace (a ptin-tier tenant) and invites its owner.
 * `repoFor` gives the new tenant's own scoped repository. Returns the one-time link token (only its hash is stored).
 */
export async function provisionWorkspace(
  platform: PracticePlatform, repoFor: (tenantId: string) => PracticeRepo, adminUserId: string, raw: { workspaceName: string; email: string; fullName: string },
  deps: { now?: () => Date; slug?: () => string } = {},
): Promise<{ tenantId: string; member: PracticeMember; token: string }> {
  const { email, fullName, workspaceName } = cleanInput(raw);
  const tenant = await platform.createTenant({ slug: slugFor(workspaceName, deps.slug), name: workspaceName, tier: "ptin" });
  const repo = repoFor(tenant.id);
  const token = newToken();
  const member = await repo.insertMember({ email, full_name: fullName, ...inviteFields(deps, token, adminUserId) });
  await repo.addAudit({ actor_id: adminUserId, action: "workspace_created", subject_type: "practice_member", subject_id: member.id, detail: { tier: "ptin", email } });
  return { tenantId: tenant.id, member, token };
}

/** Platform administrator: a fresh link for an invite that is still pending (or was withdrawn before being accepted). */
export async function reissueInvite(deps: PracticeDeps, adminUserId: string, memberId: string): Promise<{ member: PracticeMember; token: string }> {
  const m = (await deps.repo.getMember(memberId)) ?? fail("That invite wasn't found.");
  if (m.user_id) fail("That person has already accepted. They can sign in with their own password.");
  const token = newToken();
  const member = await deps.repo.updateMember(m.id, { ...inviteFields(deps, token, adminUserId), status: "invited" });
  await deps.repo.addAudit({ actor_id: adminUserId, action: "invite_resent", subject_type: "practice_member", subject_id: m.id, detail: { email: m.email } });
  return { member, token };
}

/** Platform administrator: withdraws an invite that hasn't been accepted. */
export async function withdrawInvite(deps: PracticeDeps, adminUserId: string, memberId: string): Promise<void> {
  const m = (await deps.repo.getMember(memberId)) ?? fail("That invite wasn't found.");
  if (m.status !== "invited") fail("Only an invite that hasn't been accepted can be withdrawn. Suspend the account instead.");
  await deps.repo.updateMember(m.id, { status: "suspended", invite_token_hash: null, invite_expires_at: null });
  await deps.repo.addAudit({ actor_id: adminUserId, action: "invite_withdrawn", subject_type: "practice_member", subject_id: m.id, detail: { email: m.email } });
}

/** Platform administrator: suspends or reactivates an account that has signed in. */
export async function setSuspended(deps: PracticeDeps, adminUserId: string, memberId: string, suspended: boolean): Promise<void> {
  const m = (await deps.repo.getMember(memberId)) ?? fail("That account wasn't found.");
  if (suspended === (m.status === "suspended")) return;
  if (!suspended && !m.user_id) fail("That invite was withdrawn and its link no longer works. Send a new invite instead.");
  await deps.repo.updateMember(m.id, { status: suspended ? "suspended" : "active" });
  await deps.repo.addAudit({ actor_id: adminUserId, action: suspended ? "suspended" : "reactivated", subject_type: "practice_member", subject_id: m.id, detail: { email: m.email } });
}

export type PracticeInviteCheck<T> = { member: T; reason: "ok" } | { member: null; reason: "malformed" | "not_found" | "expired" };

export async function checkInvite<T extends PracticeMember>(token: unknown, lookup: (hash: string) => Promise<T | null>, at: Date = new Date()): Promise<PracticeInviteCheck<T>> {
  const clean = cleanToken(token);
  if (!clean) return { member: null, reason: "malformed" };
  const m = await lookup(hashToken(clean));
  if (!m || m.status !== "invited" || !m.invite_expires_at) return { member: null, reason: "not_found" };
  if (Date.parse(m.invite_expires_at) < at.getTime()) return { member: null, reason: "expired" };
  return { member: m, reason: "ok" };
}
export async function inviteFor<T extends PracticeMember>(token: string, lookup: (hash: string) => Promise<T | null>, at: Date = new Date()): Promise<T | null> {
  return (await checkInvite(token, lookup, at)).member;
}

/** Links the invite to the signed-in account. The link stops working; two-step sign-in is the next step. */
export async function acceptInvite(deps: PracticeDeps, platform: PracticePlatform, tenantId: string, member: PracticeMember, userId: string, userEmail: string): Promise<PracticeMember> {
  if (member.email.toLowerCase() !== userEmail.toLowerCase()) fail(`This invite is for ${member.email}. Sign in with that email to accept it.`);
  const done = await deps.repo.updateMember(member.id, { user_id: userId, status: "active", accepted_at: nowOf(deps).toISOString(), invite_token_hash: null, invite_expires_at: null });
  await platform.addTenantMember(tenantId, userId, "owner");
  await deps.repo.addAudit({ actor_id: userId, action: "invite_accepted", subject_type: "practice_member", subject_id: member.id, detail: {} });
  return done;
}

export function inviteEmail(input: { brand: string; workspace: string; name: string; link: string }) {
  return {
    subject: `You're invited to your ${input.brand} workspace`,
    text: [
      `Hi ${input.name},`,
      "",
      `A workspace for ${input.workspace} has been set up for you on ${input.brand}.`,
      "",
      `Accept the invite and set your password here (the link works for ${INVITE_DAYS} days and only once):`,
      input.link,
      "",
      "You'll also turn on two-step sign-in with an authenticator app. It's required for every account that can reach client data.",
      "",
      "If you weren't expecting this, you can ignore this email.",
    ].join("\n"),
  };
}
