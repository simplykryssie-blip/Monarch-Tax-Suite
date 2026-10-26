import { createHash, randomBytes } from "node:crypto";
import { ValidationError } from "../commerce/validation.ts";
import type { FormDeps } from "./service.ts";
import type { FormInvite, FormRow } from "./types.ts";

// A form sent to one client: a personal link. The link is a long random token; only its hash is stored. Opening it shows
// the form with that client's details filled in; submitting it ties the submission to the client.

export const INVITE_DAYS = 30;
export const hashInvite = (token: string) => createHash("sha256").update(token).digest("hex");
export const isInviteToken = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{40,60}$/.test(v);
const nowOf = (d: FormDeps) => (d.now ? d.now() : new Date());
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type InviteClient = { id: string; full_name: string; email: string | null; archived_at?: string | null };

/** Makes a client's personal link for a published form. Returns the token once: it cannot be looked up again. */
export async function createInvite(deps: FormDeps, input: { formId: string; client: InviteClient; days?: number; createdBy: string | null }): Promise<{ invite: FormInvite; token: string; form: FormRow }> {
  const form = await deps.repo.getForm(input.formId);
  if (!form || form.status !== "published" || !form.current_version_id) throw new ValidationError("Choose a published form.");
  if (input.client.archived_at) throw new ValidationError("This client is archived.");
  if (!input.client.email || !EMAIL.test(input.client.email)) throw new ValidationError("Add the client's email address first. The link is sent there.");
  const days = Math.min(Math.max(Math.round(input.days ?? INVITE_DAYS) || INVITE_DAYS, 1), 90);
  const token = randomBytes(32).toString("base64url");
  const invite = await deps.repo.insertInvite({
    form_id: form.id, client_id: input.client.id, token_hash: hashInvite(token), sent_to: input.client.email,
    expires_at: new Date(nowOf(deps).getTime() + days * 86_400_000).toISOString(), created_by: input.createdBy,
  });
  return { invite, token, form };
}

export type InviteState = { ok: true; invite: FormInvite } | { ok: false; reason: "invalid" | "expired" | "revoked" | "done" };

/** Whether a personal link may still be used for this form. */
export async function checkInvite(deps: FormDeps, formId: string, token: unknown): Promise<InviteState> {
  if (!isInviteToken(token)) return { ok: false, reason: "invalid" };
  const invite = await deps.repo.getInviteByHash(hashInvite(token));
  if (!invite || invite.form_id !== formId) return { ok: false, reason: "invalid" };
  if (invite.revoked_at) return { ok: false, reason: "revoked" };
  if (invite.submission_id) return { ok: false, reason: "done" };
  if (Date.parse(invite.expires_at) < nowOf(deps).getTime()) return { ok: false, reason: "expired" };
  return { ok: true, invite };
}

export const INVITE_PROBLEMS: Record<Exclude<InviteState, { ok: true }>["reason"], string> = {
  invalid: "This link is not valid. Check that you copied the whole address.",
  expired: "This link has expired. Ask the office to send you a new one.",
  revoked: "This link was cancelled. Ask the office to send you a new one.",
  done: "This form has already been completed. Thank you.",
};

export async function markInviteOpened(deps: FormDeps, invite: FormInvite): Promise<void> {
  if (!invite.opened_at) await deps.repo.updateInvite(invite.id, { opened_at: nowOf(deps).toISOString() });
}

/** Cancels a link that hasn't been used. */
export async function revokeInvite(deps: FormDeps, inviteId: string, clientId: string): Promise<void> {
  const invite = (await deps.repo.listInvitesForClient(clientId, 200)).find((i) => i.id === inviteId);
  if (!invite) throw new ValidationError("That form wasn't found.");
  if (invite.submission_id) throw new ValidationError("That form has already been completed.");
  if (!invite.revoked_at) await deps.repo.updateInvite(invite.id, { revoked_at: nowOf(deps).toISOString() });
}

export type InviteStatus = "completed" | "opened" | "sent" | "expired" | "cancelled";
export function inviteStatus(i: FormInvite, now: Date = new Date()): InviteStatus {
  if (i.submission_id) return "completed";
  if (i.revoked_at) return "cancelled";
  if (Date.parse(i.expires_at) < now.getTime()) return "expired";
  return i.opened_at ? "opened" : "sent";
}
