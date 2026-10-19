import { isEmailAddress } from "../automation/email.ts";
import { ValidationError } from "../commerce/validation.ts";
import { parseTags } from "../leads/tags.ts";
import type { AudienceContact, ContactKind } from "./audience.ts";
import type { CampaignRepo } from "./service.ts";

// The consent tools on the Contacts page: mark people marketable (the account owner's say-so), record that they agreed to
// texts, or take their marketing consent away. All work on a list of people the owner ticked.

export const MAX_BULK = 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "client:<id>" / "lead:<id>" values from the page's checkboxes. */
export function parsePicks(values: unknown[]): { kind: ContactKind; id: string }[] {
  const out: { kind: ContactKind; id: string }[] = [];
  for (const v of values) {
    const m = typeof v === "string" ? v.match(/^(lead|client):([0-9a-f-]{36})$/i) : null;
    if (m && UUID.test(m[2])) out.push({ kind: m[1].toLowerCase() as ContactKind, id: m[2].toLowerCase() });
  }
  if (out.length === 0) throw new ValidationError("Tick at least one person first.");
  if (out.length > MAX_BULK) throw new ValidationError(`Choose at most ${MAX_BULK} people at a time.`);
  return out;
}

export type BulkResult = { changed: number; noEmail: number };
type Pick = { kind: ContactKind; id: string };

const withEmail = (contacts: AudienceContact[], picks: Pick[]) => {
  const wanted = new Set(picks.map((p) => `${p.kind}:${p.id}`));
  const chosen = contacts.filter((c) => wanted.has(`${c.kind}:${c.id}`));
  const emails = new Map<string, true>();
  let noEmail = 0;
  for (const c of chosen) {
    const e = (c.email ?? "").trim().toLowerCase();
    if (isEmailAddress(e)) emails.set(e, true); else noEmail++;
  }
  return { emails: [...emails.keys()], noEmail };
};

/** The owner marks these people as OK to send campaigns to. With `sms`, also records that they agreed to texts. */
export async function markMarketable(repo: CampaignRepo, picks: Pick[], opts: { sms: boolean; userId: string | null; note?: string }): Promise<BulkResult> {
  const { emails, noEmail } = withEmail(await repo.listContacts(), picks);
  for (const email of emails) await repo.upsertConsent({ email, basis: "owner", sms: opts.sms, markedBy: opts.userId, note: (opts.note ?? "Marked by the account owner").slice(0, 200) });
  return { changed: emails.length, noEmail };
}

/** Takes marketing consent away (also stops texts). The person is no longer in any audience until marked again. */
export async function revokeMarketing(repo: CampaignRepo, picks: Pick[], userId: string | null): Promise<BulkResult> {
  const { emails, noEmail } = withEmail(await repo.listContacts(), picks);
  for (const email of emails) await repo.revokeConsent(email, userId);
  return { changed: emails.length, noEmail };
}

export function oneTag(raw: unknown): string {
  const tags = parseTags(raw);
  if (tags.length !== 1) throw new ValidationError("Enter one tag.");
  return tags[0].slice(0, 40);
}

/** Checks an email typed in for a manual block. */
export function blockableEmail(raw: unknown): string {
  const e = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!isEmailAddress(e)) throw new ValidationError("Enter a valid email address.");
  return e;
}
