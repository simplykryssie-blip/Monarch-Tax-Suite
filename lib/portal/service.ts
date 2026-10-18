import { ValidationError } from "../commerce/validation.ts";
import { cleanToken, EMAIL, hashToken, INVITE_DAYS, newToken } from "../office/service.ts";

// Client portal sign-in. Staff invite a client by email; the client opens a one-time link, sets a password (or signs in
// with the account they already have) and lands in the portal for that office. One sign-in can belong to several
// offices: each office has its own portal_members row for the same account. Nothing here is self-serve.

export type PortalStatus = "invited" | "active" | "suspended";
export type PortalMember = {
  id: string; tenant_id: string; client_id: string; email: string; full_name: string; user_id: string | null; status: PortalStatus;
  invite_token_hash: string | null; invite_expires_at: string | null; invited_by: string | null; accepted_at: string | null; last_seen_at: string | null; created_at: string;
};
export type PortalAudit = { actor_id: string | null; action: string; subject_type?: string | null; subject_id?: string | null; detail?: Record<string, unknown> };

/** One office's portal rows (a tenant-scoped client). */
export interface PortalMemberRepo {
  getForClient(clientId: string): Promise<PortalMember | null>;
  get(id: string): Promise<PortalMember | null>;
  insert(input: { client_id: string; email: string; full_name: string; invite_token_hash: string; invite_expires_at: string; invited_by: string | null }): Promise<PortalMember>;
  update(id: string, patch: Partial<Pick<PortalMember, "status" | "user_id" | "invite_token_hash" | "invite_expires_at" | "invited_by" | "accepted_at" | "email" | "full_name" | "last_seen_at">>): Promise<PortalMember>;
  addAudit(input: PortalAudit): Promise<void>;
}
export type PortalDeps = { repo: PortalMemberRepo; now?: () => Date };
const nowOf = (d: { now?: () => Date }) => (d.now ? d.now() : new Date());
const fail = (m: string): never => { throw new ValidationError(m); };
const inviteFields = (deps: { now?: () => Date }, token: string, invitedBy: string | null) => ({
  invite_token_hash: hashToken(token), invite_expires_at: new Date(nowOf(deps).getTime() + INVITE_DAYS * 86_400_000).toISOString(), invited_by: invitedBy,
});

/** The client a staff member is inviting: the name and email on the client record. */
export type InvitableClient = { id: string; full_name: string; email: string | null; archived_at: string | null };

/** Invites a client to the portal, or sends a fresh link for an invite that is still pending. Returns the one-time token. */
export async function inviteClient(deps: PortalDeps, actorId: string | null, client: InvitableClient): Promise<{ member: PortalMember; token: string; resent: boolean }> {
  if (client.archived_at) fail("This client is archived. Restore the client before inviting them to the portal.");
  const email = (client.email ?? "").trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) fail("Add the client's email address to their profile first. The invite is sent there.");
  const name = client.full_name.replace(/\s+/g, " ").trim().slice(0, 200) || email;
  const token = newToken();
  const existing = await deps.repo.getForClient(client.id);
  if (existing) {
    if (existing.user_id) fail("This client already has a portal login. They can sign in with their own password.");
    const member = await deps.repo.update(existing.id, { ...inviteFields(deps, token, actorId), status: "invited", email, full_name: name });
    await deps.repo.addAudit({ actor_id: actorId, action: "portal_invite_resent", subject_type: "portal_member", subject_id: member.id, detail: { client_id: client.id } });
    return { member, token, resent: true };
  }
  const member = await deps.repo.insert({ client_id: client.id, email, full_name: name, ...inviteFields(deps, token, actorId) });
  await deps.repo.addAudit({ actor_id: actorId, action: "portal_invited", subject_type: "portal_member", subject_id: member.id, detail: { client_id: client.id } });
  return { member, token, resent: false };
}

/** Withdraws an invite that hasn't been accepted. */
export async function withdrawPortalInvite(deps: PortalDeps, actorId: string | null, clientId: string): Promise<void> {
  const m = (await deps.repo.getForClient(clientId)) ?? fail("This client has no portal invite.");
  if (m.user_id) fail("They have already accepted. Turn off their access instead.");
  await deps.repo.update(m.id, { status: "suspended", invite_token_hash: null, invite_expires_at: null });
  await deps.repo.addAudit({ actor_id: actorId, action: "portal_invite_withdrawn", subject_type: "portal_member", subject_id: m.id, detail: { client_id: clientId } });
}

/** Turns a client's portal access off or back on. They keep their sign-in; the portal just stops opening for this office. */
export async function setPortalAccess(deps: PortalDeps, actorId: string | null, clientId: string, enabled: boolean): Promise<void> {
  const m = (await deps.repo.getForClient(clientId)) ?? fail("This client has no portal login.");
  if (!m.user_id) fail("They haven't accepted the invite yet. Withdraw it or send a new one.");
  if (enabled === (m.status === "active")) return;
  await deps.repo.update(m.id, { status: enabled ? "active" : "suspended" });
  await deps.repo.addAudit({ actor_id: actorId, action: enabled ? "portal_access_on" : "portal_access_off", subject_type: "portal_member", subject_id: m.id, detail: { client_id: clientId } });
}

export type PortalInviteCheck<T> = { member: T; reason: "ok" } | { member: null; reason: "malformed" | "not_found" | "expired" };

export async function checkPortalInvite<T extends PortalMember>(token: unknown, lookup: (hash: string) => Promise<T | null>, at: Date = new Date()): Promise<PortalInviteCheck<T>> {
  const clean = cleanToken(token);
  if (!clean) return { member: null, reason: "malformed" };
  const m = await lookup(hashToken(clean));
  if (!m || m.status !== "invited" || !m.invite_expires_at) return { member: null, reason: "not_found" };
  if (Date.parse(m.invite_expires_at) < at.getTime()) return { member: null, reason: "expired" };
  return { member: m, reason: "ok" };
}
export async function portalInviteFor<T extends PortalMember>(token: string, lookup: (hash: string) => Promise<T | null>, at: Date = new Date()): Promise<T | null> {
  return (await checkPortalInvite(token, lookup, at)).member;
}

/** Links the invite to the signed-in account. The link stops working. The account must use the invited email. */
export async function acceptPortalInvite(deps: PortalDeps, member: PortalMember, userId: string, userEmail: string): Promise<PortalMember> {
  if (member.email.toLowerCase() !== userEmail.toLowerCase()) fail(`This invite is for ${member.email}. Sign in with that email to accept it.`);
  const done = await deps.repo.update(member.id, { user_id: userId, status: "active", accepted_at: nowOf(deps).toISOString(), invite_token_hash: null, invite_expires_at: null });
  await deps.repo.addAudit({ actor_id: userId, action: "portal_invite_accepted", subject_type: "portal_member", subject_id: member.id, detail: { client_id: member.client_id } });
  return done;
}

export function portalInviteEmail(input: { office: string; name: string; link: string }) {
  return {
    subject: `${input.office} invited you to its client portal`,
    text: [
      `Hi ${input.name},`,
      "",
      `${input.office} has set up a secure client portal for you. You can see your documents, sign forms and view invoices there.`,
      "",
      `Open this link to set your password (it works for ${INVITE_DAYS} days and only once):`,
      input.link,
      "",
      "If you weren't expecting this, you can ignore this email.",
    ].join("\n"),
  };
}
