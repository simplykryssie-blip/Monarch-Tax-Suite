import { isEmailAddress } from "../automation/email.ts";
import { toE164 } from "../automation/twilio.ts";
import { ValidationError } from "../commerce/validation.ts";
import { parseTags } from "../leads/tags.ts";

// Who a campaign may go to. Two questions are kept apart on purpose: WHO the office picked (the filter: tags, status, a
// hand-picked list) and WHO MAY BE CONTACTED (consent and suppression). The second always wins: a person who isn't
// marketable, has unsubscribed or replied STOP, or bounced or complained is never in the audience, however it was picked.

export type ContactKind = "lead" | "client";
export type AudienceContact = {
  kind: ContactKind; id: string; name: string | null; email: string | null; phone: string | null; tags: string[]; status: string | null;
  archived: boolean;
  /** Booked an appointment with the office (marketable without a separate opt-in). */
  booked: boolean;
  /** Ticked the text-reminder box when booking. */
  bookingSms: boolean;
};
export type ConsentRow = { email: string; basis: "form" | "owner" | "import"; sms_consent: boolean; revoked: boolean };

export type AudienceFilter = {
  mode: "filter" | "manual";
  kinds: ContactKind[];
  /** A person qualifies when they have at least one of these tags (empty = no tag condition). */
  tagsAny: string[];
  /** ...and none of these. */
  tagsNone: string[];
  /** Lead statuses to include (empty = any). Clients are always included when `kinds` has "client". */
  leadStatus: string[];
  /** The hand-picked people for mode "manual". */
  picked: { kind: ContactKind; id: string }[];
};
export const EMPTY_FILTER: AudienceFilter = { mode: "filter", kinds: ["lead", "client"], tagsAny: [], tagsNone: [], leadStatus: [], picked: [] };
export const MAX_PICKED = 5000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const LEAD_STATUSES = ["new", "interested", "converted", "lost"] as const;

/** Turns whatever the form sent into a clean filter. */
export function sanitizeFilter(raw: unknown): AudienceFilter {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const kinds = (Array.isArray(r.kinds) ? r.kinds : ["lead", "client"]).filter((k): k is ContactKind => k === "lead" || k === "client");
  const picked: AudienceFilter["picked"] = [];
  if (Array.isArray(r.picked)) {
    if (r.picked.length > MAX_PICKED) throw new ValidationError(`Pick at most ${MAX_PICKED} people by hand, or use tags to choose a bigger group.`);
    for (const p of r.picked) {
      const x = p as { kind?: unknown; id?: unknown };
      if ((x?.kind === "lead" || x?.kind === "client") && typeof x.id === "string" && UUID.test(x.id)) picked.push({ kind: x.kind, id: x.id.toLowerCase() });
    }
  }
  return {
    mode: r.mode === "manual" ? "manual" : "filter",
    kinds: kinds.length ? [...new Set(kinds)] : ["lead", "client"],
    tagsAny: parseTags(r.tagsAny), tagsNone: parseTags(r.tagsNone),
    leadStatus: (Array.isArray(r.leadStatus) ? r.leadStatus : []).filter((s): s is string => typeof s === "string" && (LEAD_STATUSES as readonly string[]).includes(s)),
    picked,
  };
}

/** Whether the filter alone (before consent) picks this person. */
export function matchesFilter(c: AudienceContact, f: AudienceFilter): boolean {
  if (f.mode === "manual") return f.picked.some((p) => p.kind === c.kind && p.id === c.id);
  if (!f.kinds.includes(c.kind)) return false;
  if (f.tagsAny.length && !f.tagsAny.some((t) => c.tags.includes(t))) return false;
  if (f.tagsNone.some((t) => c.tags.includes(t))) return false;
  if (c.kind === "lead" && f.leadStatus.length && !f.leadStatus.includes(c.status ?? "")) return false;
  return true;
}

export type Channel = "email" | "sms";
export type Exclusion = "no_address" | "archived" | "not_marketable" | "no_text_consent" | "suppressed" | "blocked_everywhere";
export const EXCLUSION_TEXT: Record<Exclusion, string> = {
  no_address: "no email address or valid mobile number",
  archived: "archived",
  not_marketable: "no marketing consent on record",
  no_text_consent: "no text-message consent",
  suppressed: "unsubscribed, replied STOP, bounced or complained",
  blocked_everywhere: "blocked platform-wide (hard bounce or spam complaint)",
};

export type Eligible = { kind: ContactKind; id: string; name: string | null; address: string };
export type AudienceContext = {
  channel: Channel;
  consents: Map<string, ConsentRow>;
  /** This office's suppressions for the channel, lower-case emails or +E.164 numbers. */
  suppressed: Set<string>;
  /** True when the address is on the platform-wide list (hard bounce or complaint). */
  platformBlocked: (address: string) => boolean;
};

/** The address a channel would use for this person, cleaned; null when there isn't a usable one. */
export function addressFor(c: Pick<AudienceContact, "email" | "phone">, channel: Channel): string | null {
  if (channel === "email") {
    const e = (c.email ?? "").trim().toLowerCase();
    return isEmailAddress(e) ? e : null;
  }
  return toE164(c.phone);
}

/** Consent: clients and people who booked are marketable; anyone else needs a consent row. A revoked row blocks everyone. */
export function marketable(c: AudienceContact, consent: ConsentRow | undefined): boolean {
  if (consent?.revoked) return false;
  if (c.kind === "client") return true;
  return c.booked || Boolean(consent);
}
export const textConsent = (c: AudienceContact, consent: ConsentRow | undefined) => !consent?.revoked && (Boolean(consent?.sms_consent) || c.bookingSms);

export type AudienceResult = { eligible: Eligible[]; excluded: Record<Exclusion, number>; picked: number };

/** The audience: the people the filter picks, minus everyone who may not be contacted, one entry per address. */
export function resolveAudience(contacts: AudienceContact[], filter: AudienceFilter, ctx: AudienceContext): AudienceResult {
  const excluded: Record<Exclusion, number> = { no_address: 0, archived: 0, not_marketable: 0, no_text_consent: 0, suppressed: 0, blocked_everywhere: 0 };
  const eligible: Eligible[] = [];
  const seen = new Set<string>();
  let picked = 0;
  for (const c of contacts) {
    if (!matchesFilter(c, filter)) continue;
    picked++;
    if (c.archived) { excluded.archived++; continue; }
    const address = addressFor(c, ctx.channel);
    if (!address) { excluded.no_address++; continue; }
    // Consent is keyed by email, for both channels.
    const consent = c.email ? ctx.consents.get(c.email.trim().toLowerCase()) : undefined;
    if (!marketable(c, consent)) { excluded.not_marketable++; continue; }
    if (ctx.channel === "sms" && !textConsent(c, consent)) { excluded.no_text_consent++; continue; }
    if (ctx.suppressed.has(address)) { excluded.suppressed++; continue; }
    if (ctx.platformBlocked(address)) { excluded.blocked_everywhere++; continue; }
    // A person who is both a lead and a client, or has two records with the same address, is sent one message.
    if (seen.has(address)) continue;
    seen.add(address);
    eligible.push({ kind: c.kind, id: c.id, name: c.name, address });
  }
  return { eligible, excluded, picked };
}

/** "12 people have no consent on record, 3 unsubscribed…" for the audience screen. */
export function exclusionSummary(excluded: Record<Exclusion, number>): string[] {
  return (Object.keys(excluded) as Exclusion[]).filter((k) => excluded[k] > 0).map((k) => `${excluded[k]} ${excluded[k] === 1 ? "person" : "people"}: ${EXCLUSION_TEXT[k]}`);
}
