import { createHash, randomBytes } from "node:crypto";
import { ValidationError } from "../commerce/validation.ts";
import { cleanPermissions, defaultPermissions, type Permissions } from "./permissions.ts";

// The office area's people: invites, accepting them, the ERO's choices for each preparer, and suspension. Every
// change is written to the office history.

export type MemberRole = "ero" | "preparer";
export type OfficeMember = {
  id: string; organization_id: string; role: MemberRole; email: string; full_name: string; user_id: string | null;
  status: "invited" | "active" | "suspended"; permissions: Permissions; invite_token_hash: string | null; invite_expires_at: string | null;
  invited_by: string | null; accepted_at: string | null; last_seen_at: string | null; created_at: string;
};
export type OfficeEvent = { id: string; organization_id: string | null; member_id: string | null; action: string; actor_id: string | null; detail: Record<string, unknown>; created_at: string };

export interface OfficeRepo {
  listOffices(): Promise<{ id: string; name: string; archived: boolean }[]>;
  listMembers(officeId?: string): Promise<OfficeMember[]>;
  getMember(id: string): Promise<OfficeMember | null>;
  insertMember(input: Omit<OfficeMember, "id" | "created_at" | "user_id" | "accepted_at" | "last_seen_at" | "status"> & { status?: OfficeMember["status"] }): Promise<OfficeMember>;
  updateMember(id: string, patch: Partial<OfficeMember>): Promise<OfficeMember>;
  addEvent(input: Omit<OfficeEvent, "id" | "created_at">): Promise<void>;
  listEvents(officeId: string, limit?: number): Promise<OfficeEvent[]>;
}

export type OfficeDeps = { repo: OfficeRepo; now?: () => Date };
const now = (d: OfficeDeps) => (d.now ? d.now() : new Date());
const fail = (m: string): never => { throw new ValidationError(m); };

export const INVITE_DAYS = 7;
export const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");

/** The person acting: a bureau administrator, or a member of the office (only an ERO may manage the team). */
export type Actor = { userId: string; bureau: boolean; member?: OfficeMember | null };

function mayManage(actor: Actor, officeId: string, role: MemberRole) {
  if (actor.bureau) return;
  const m = actor.member;
  if (!m || m.status !== "active" || m.role !== "ero" || m.organization_id !== officeId) fail("Only this office's ERO or the bureau can manage its team.");
  if (role === "ero") fail("Only the bureau can add or change an ERO.");
}

/**
 * Invites someone to an office. The bureau invites EROs; an ERO invites preparers. Returns the one-time link token
 * (only its hash is stored); the caller emails it and may show it to the inviter.
 */
export async function invite(deps: OfficeDeps, actor: Actor, input: { officeId: string; role: string; email: string; fullName: string }): Promise<{ member: OfficeMember; token: string }> {
  const role: MemberRole = input.role === "ero" ? "ero" : "preparer";
  mayManage(actor, input.officeId, role);
  const office = (await deps.repo.listOffices()).find((o) => o.id === input.officeId) ?? fail("That office wasn't found.");
  if (office.archived) fail("That office is archived.");
  const email = input.email.trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) fail("Enter a valid email address.");
  const fullName = input.fullName.replace(/\s+/g, " ").trim();
  if (fullName.length < 2 || fullName.length > 200) fail("Enter the person's name.");
  const existing = (await deps.repo.listMembers(input.officeId)).find((m) => m.email.toLowerCase() === email);
  // A pending invite, or one that was withdrawn before it was ever accepted, can be sent again with a fresh link.
  const reinvite = existing && (existing.status === "invited" || (existing.status === "suspended" && !existing.user_id));
  if (existing && !reinvite) fail(`${email} is already on this office's team.`);
  const token = newToken();
  const fields = { invite_token_hash: hashToken(token), invite_expires_at: new Date(now(deps).getTime() + INVITE_DAYS * 86_400_000).toISOString(), invited_by: actor.userId };
  const member = existing
    ? await deps.repo.updateMember(existing.id, { ...fields, full_name: fullName, role, status: "invited" })
    : await deps.repo.insertMember({ organization_id: input.officeId, role, email, full_name: fullName, permissions: role === "preparer" ? defaultPermissions() : {}, ...fields });
  await deps.repo.addEvent({ organization_id: input.officeId, member_id: member.id, action: existing ? "invite_resent" : "invited", actor_id: actor.userId, detail: { role, email } });
  return { member, token };
}

/**
 * The token out of what a link carries. Tolerates what pasting and chat apps do to a link: a percent-encoded token,
 * spaces, a trailing full stop, comma or bracket, and a query string or fragment. Null when nothing like a token is there.
 */
export function cleanToken(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let v = raw;
  try { v = decodeURIComponent(v); } catch { /* keep it as it is */ }
  v = v.trim().split(/[?#/\s]/)[0].replace(/^[^A-Za-z0-9_-]+|[^A-Za-z0-9_-]+$/g, "");
  return /^[A-Za-z0-9_-]{40,60}$/.test(v) ? v : null;
}

export type InviteCheck<T> = { member: T; reason: "ok" } | { member: null; reason: "malformed" | "not_found" | "expired" };

/**
 * The invite a link points at, and why not when there isn't one. "not_found": the link was used, withdrawn or replaced
 * by a newer invite (each of those clears the old link), or was never valid.
 */
export async function checkInvite<T extends OfficeMember>(token: unknown, lookup: (hash: string) => Promise<T | null>, at: Date = new Date()): Promise<InviteCheck<T>> {
  const clean = cleanToken(token);
  if (!clean) return { member: null, reason: "malformed" };
  const m = await lookup(hashToken(clean));
  if (!m || m.status !== "invited" || !m.invite_expires_at) return { member: null, reason: "not_found" };
  if (Date.parse(m.invite_expires_at) < at.getTime()) return { member: null, reason: "expired" };
  return { member: m, reason: "ok" };
}

/** The invite a link points at, while it's valid. */
export async function inviteFor<T extends OfficeMember>(token: string, lookup: (hash: string) => Promise<T | null>, at: Date = new Date()): Promise<T | null> {
  return (await checkInvite(token, lookup, at)).member;
}

/** Links the invite to the signed-in account. The link stops working; two-step sign-in is the next step. */
export async function acceptInvite(deps: OfficeDeps, member: OfficeMember, userId: string, userEmail: string): Promise<OfficeMember> {
  if (member.email.toLowerCase() !== userEmail.toLowerCase()) fail(`This invite is for ${member.email}. Sign in with that email to accept it.`);
  const done = await deps.repo.updateMember(member.id, { user_id: userId, status: "active", accepted_at: now(deps).toISOString(), invite_token_hash: null, invite_expires_at: null });
  await deps.repo.addEvent({ organization_id: member.organization_id, member_id: member.id, action: "invite_accepted", actor_id: userId, detail: { role: member.role } });
  return done;
}

/** The ERO's choices for one preparer. */
export async function setPermissions(deps: OfficeDeps, actor: Actor, memberId: string, raw: Record<string, unknown>): Promise<void> {
  const m = (await deps.repo.getMember(memberId)) ?? fail("That team member wasn't found.");
  mayManage(actor, m.organization_id, m.role);
  if (m.role !== "preparer") fail("An ERO has every ERO feature; there's nothing to set.");
  const permissions = cleanPermissions(raw);
  await deps.repo.updateMember(memberId, { permissions });
  await deps.repo.addEvent({ organization_id: m.organization_id, member_id: m.id, action: "permissions_changed", actor_id: actor.userId, detail: { from: m.permissions, to: permissions } });
}

export async function setSuspended(deps: OfficeDeps, actor: Actor, memberId: string, suspended: boolean): Promise<void> {
  const m = (await deps.repo.getMember(memberId)) ?? fail("That team member wasn't found.");
  mayManage(actor, m.organization_id, m.role);
  if (!actor.bureau && actor.member?.id === m.id) fail("You can't suspend yourself.");
  if (suspended && m.status === "suspended") return;
  if (!suspended && m.status !== "suspended") return;
  // A withdrawn invite has no link any more; "reactivating" it would leave an invite nobody can open.
  if (!suspended && !m.user_id) fail("That invite was withdrawn and its link no longer works. Send a new invite instead.");
  await deps.repo.updateMember(memberId, { status: suspended ? "suspended" : "active" });
  await deps.repo.addEvent({ organization_id: m.organization_id, member_id: m.id, action: suspended ? "suspended" : "reactivated", actor_id: actor.userId, detail: { email: m.email } });
}

/** Withdraws an invite that hasn't been accepted. */
export async function cancelInvite(deps: OfficeDeps, actor: Actor, memberId: string): Promise<void> {
  const m = (await deps.repo.getMember(memberId)) ?? fail("That invite wasn't found.");
  mayManage(actor, m.organization_id, m.role);
  if (m.status !== "invited") fail("Only an invite that hasn't been accepted can be withdrawn. Suspend the member instead.");
  await deps.repo.updateMember(memberId, { status: "suspended", invite_token_hash: null, invite_expires_at: null });
  await deps.repo.addEvent({ organization_id: m.organization_id, member_id: m.id, action: "invite_withdrawn", actor_id: actor.userId, detail: { email: m.email } });
}

/** The invite email: no personal data beyond the office and the inviter's choice of name. */
export function inviteEmail(input: { brand: string; office: string; name: string; role: MemberRole; link: string }) {
  const what = input.role === "ero" ? "the ERO for" : "a preparer at";
  return {
    subject: `You're invited to ${input.office} on ${input.brand}`,
    text: [
      `Hi ${input.name},`,
      "",
      `You've been invited to join ${input.office} on ${input.brand} as ${what} the office.`,
      "",
      `Accept the invite and set your password here (the link works for ${INVITE_DAYS} days and only once):`,
      input.link,
      "",
      "We recommend turning on two-step sign-in with an authenticator app. It keeps client information safe even if a password is stolen, and it's your choice.",
      "",
      "If you weren't expecting this, you can ignore this email.",
    ].join("\n"),
  };
}
