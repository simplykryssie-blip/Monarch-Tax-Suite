import { createHash, createHmac } from "node:crypto";
import { ValidationError } from "../commerce/validation.ts";
import { blockHtml, parseRich, richToText, type Block, type Inline } from "../richtext.ts";

// Writing a campaign: the merge fields, the checks a message must pass before it can be sent (CAN-SPAM), and turning it
// into the email or text one recipient gets. Pure: the send engine and the preview screen both use these.

export const CAMPAIGN_VARIABLES: Record<string, string> = {
  first_name: "The person's first name (“there” if we don't have one)",
  name: "The person's full name",
  office_name: "Your office's name",
  office_phone: "Your office's phone number",
  office_email: "Your office's email address",
};
export const SAMPLE_CAMPAIGN_VALUES: Record<string, string> = { first_name: "Jane", name: "Jane Sample", office_name: "Sample Tax Office", office_phone: "(555) 010-0000", office_email: "office@example.com" };
const TOKEN = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
export const unknownCampaignVariables = (...texts: string[]) => [...new Set(texts.flatMap((t) => [...t.matchAll(TOKEN)].map((m) => m[1])))].filter((v) => !Object.prototype.hasOwnProperty.call(CAMPAIGN_VARIABLES, v));

export function valuesFor(person: { name: string | null }, office: { name: string; phone: string | null; email: string | null }): Record<string, string> {
  const full = (person.name ?? "").replace(/\s+/g, " ").trim();
  return { first_name: full.split(" ")[0] || "there", name: full || "there", office_name: office.name, office_phone: office.phone ?? "", office_email: office.email ?? "" };
}

// ---------------------------------------------------------------- checks

export const SMS_MAX_SEGMENTS = 4;

/** GSM-7 characters cost 1 per character (160 per segment, 153 when joined); anything else makes it UCS-2 (70 / 67). */
const GSM = new Set("@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà");
const GSM_EXT = new Set("^{}\\[~]|€");
export function smsSegments(text: string): { segments: number; encoding: "GSM-7" | "UCS-2"; length: number } {
  let units = 0;
  let gsm = true;
  for (const ch of text) {
    if (GSM.has(ch)) units += 1;
    else if (GSM_EXT.has(ch)) units += 2;
    else { gsm = false; break; }
  }
  if (gsm) return { segments: units === 0 ? 0 : units <= 160 ? 1 : Math.ceil(units / 153), encoding: "GSM-7", length: units };
  const len = [...text].reduce((n, ch) => n + (ch.codePointAt(0)! > 0xffff ? 2 : 1), 0);
  return { segments: len <= 70 ? 1 : Math.ceil(len / 67), encoding: "UCS-2", length: len };
}

/** Subject lines that pretend to be a reply or a forward, or shout, are the classic "deceptive subject" (CAN-SPAM). */
export function subjectProblems(subject: string): string[] {
  const s = subject.replace(/\s+/g, " ").trim();
  const out: string[] = [];
  if (!s) out.push("Write a subject line.");
  if (s.length > 150) out.push("Keep the subject under 150 characters.");
  if (/^(re|fw|fwd)\s*:/i.test(s)) out.push("A subject can't start with Re: or Fwd:. That makes it look like a reply or a forwarded message, which the law treats as deceptive.");
  const letters = s.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 12 && letters === letters.toUpperCase()) out.push("Don't write the whole subject in capital letters.");
  return out;
}

export type MessageInput = { channel: "email" | "sms"; subject: string | null; body: string };
/** Everything wrong with a message, in plain words. Empty means it can be scheduled. */
export function messageProblems(m: MessageInput, office: { address: string | null }): string[] {
  const problems: string[] = [];
  if (!m.body.trim()) problems.push("Write the message.");
  const unknown = unknownCampaignVariables(m.subject ?? "", m.body);
  if (unknown.length) problems.push(`Unknown merge field${unknown.length > 1 ? "s" : ""}: ${unknown.map((u) => `{{${u}}}`).join(", ")}. Use ${Object.keys(CAMPAIGN_VARIABLES).map((k) => `{{${k}}}`).join(", ")}.`);
  if (m.channel === "email") {
    problems.push(...subjectProblems(m.subject ?? ""));
    if (!office.address?.trim()) problems.push("Add your office's mailing address in Settings → Firm profile. Every marketing email must show a physical address.");
    if (/\{\{\s*unsubscribe/i.test(m.body)) problems.push("Don't add your own unsubscribe link; one is added to every email for you.");
  } else {
    const probe = smsSegments(renderSmsBody(m.body, SAMPLE_CAMPAIGN_VALUES));
    if (probe.segments > SMS_MAX_SEGMENTS) problems.push(`That text is too long: ${probe.segments} message parts (the most is ${SMS_MAX_SEGMENTS}). Shorten it.`);
  }
  return problems;
}

// ------------------------------------------------------------------ links

const token = (key: Buffer, recipientId: string) => createHmac("sha256", key).update(`campaign-link:v1:${recipientId}`).digest("base64url");
export const hashRecipientToken = (t: string) => createHash("sha256").update(t).digest("hex");
/** The secret link token for one recipient. Only its SHA-256 is stored; the token itself is rebuilt when needed. */
export const recipientToken = token;
export const TOKEN_SHAPE = /^[A-Za-z0-9_-]{40,50}$/;

function mapInline(nodes: Inline[], f: (n: Inline) => Inline | null): Inline[] {
  return nodes.flatMap((n) => {
    const m = f(n);
    if (!m) return [];
    return "c" in m && Array.isArray(m.c) ? [{ ...m, c: mapInline(m.c, f) } as Inline] : [m];
  });
}
function mapBlocks(blocks: Block[], f: (n: Inline) => Inline | null): Block[] {
  return blocks.map((b) => (b.t === "ul" || b.t === "ol" ? { ...b, items: b.items.map((i) => mapInline(i, f)) } : { ...b, c: mapInline(b.c, f) }));
}
function walk(nodes: Inline[], visit: (n: Inline) => void) {
  for (const n of nodes) { visit(n); if ("c" in n && Array.isArray(n.c)) walk(n.c, visit); }
}

export const MAX_LINKS = 40;
/** The https links in a message, in order of first appearance. Click counting is per link. */
export function linkTable(body: string): string[] {
  const urls: string[] = [];
  for (const b of parseRich(body)) for (const nodes of b.t === "ul" || b.t === "ol" ? b.items : [b.c]) walk(nodes, (n) => { if (n.t === "a" && /^https:\/\/[^\s<>"']+$/.test(n.href) && !urls.includes(n.href)) urls.push(n.href); });
  if (urls.length > MAX_LINKS) throw new ValidationError(`Use at most ${MAX_LINKS} different links in one email.`);
  return urls;
}

// ------------------------------------------------------------------ email

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const clean = (v: string) => v.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").slice(0, 2000);

export type EmailBrandInput = { name: string; color: string; textColor: string; logoUrl: string | null };
export type RenderEmailInput = {
  subject: string; body: string; values: Record<string, string>; brand: EmailBrandInput;
  /** The office's physical mailing address (required by CAN-SPAM). */
  address: string;
  /** Where the unsubscribe page is for this person; "#" in a preview. */
  unsubscribeUrl: string;
  /** Tracked address for a link in the message, or null to leave links as they are (preview). */
  trackLink: ((url: string) => string) | null;
  /** The 1×1 picture that counts an open, or null. */
  openPixel: string | null;
  /** Shown above the message in a preview so nobody mistakes it for a sent email. */
  previewBanner?: boolean;
};
export type RenderedCampaignEmail = { subject: string; html: string; text: string };

export function renderEmail(i: RenderEmailInput): RenderedCampaignEmail {
  const unknown = unknownCampaignVariables(i.subject, i.body);
  if (unknown.length) throw new ValidationError(`Unknown merge field(s): ${unknown.join(", ")}`);
  const fill = (t: string) => t.replace(TOKEN, (_m, n: string) => clean(i.values[n] ?? "")).replace(/\s+/g, " ").trim().slice(0, 200);
  const subject = fill(i.subject);
  const retarget = (n: Inline): Inline | null => (n.t === "a" ? (/^https:\/\/[^\s<>"']+$/.test(n.href) ? (i.trackLink ? { ...n, href: i.trackLink(n.href) } : n) : { t: "text", v: "" }) : n);
  const blocks = mapBlocks(parseRich(i.body), retarget);
  const val = (name: string) => clean(i.values[name] ?? "");
  const htmlBlocks = blocks.map((b) => blockHtml(b, val)).join("");
  const text = richToText(blocks, Object.fromEntries(Object.keys(CAMPAIGN_VARIABLES).map((k) => [k, val(k)])));
  const office = clean(i.brand.name);
  const addr = clean(i.address).replace(/\s*\n\s*/g, ", ");
  const logo = i.brand.logoUrl && /^https:\/\//.test(i.brand.logoUrl) ? `<img src="${esc(i.brand.logoUrl)}" alt="${esc(office)}" height="36" style="display:block;max-height:36px;max-width:240px;border:0">` : esc(office.toUpperCase());
  const banner = i.previewBanner ? `<tr><td style="background:#fff7d6;color:#5b4a00;padding:8px 24px;font-size:12px">Preview with sample data. Nothing has been sent.</td></tr>` : "";
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f3f1ea;font-family:Arial,Helvetica,sans-serif;color:#2b2a26"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:16px 8px"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border:1px solid #e3dfd2;border-radius:6px">${banner}<tr><td style="background:${esc(i.brand.color)};color:${esc(i.brand.textColor)};padding:16px 24px;font-size:13px;letter-spacing:2px;font-weight:700">${logo}</td></tr><tr><td style="padding:24px;font-size:16px;line-height:1.55">${htmlBlocks}</td></tr><tr><td style="padding:16px 24px;border-top:1px solid #eee;font-size:12px;line-height:1.5;color:#6b665a">You're receiving this email from ${esc(office)} because you're one of its clients or contacts.<br>${esc(office)}, ${esc(addr)}<br><a href="${esc(i.unsubscribeUrl)}" style="color:#6b665a">Unsubscribe</a> from ${esc(office)}'s emails.</td></tr></table>${i.openPixel ? `<img src="${esc(i.openPixel)}" width="1" height="1" alt="" style="display:block;border:0">` : ""}</td></tr></table></body></html>`;
  return { subject, html, text: `${text}\n\n--\nYou're receiving this email from ${office} because you're one of its clients or contacts.\n${office}, ${addr}\nUnsubscribe: ${i.unsubscribeUrl}\n` };
}

// -------------------------------------------------------------------- SMS

export const SMS_OPT_OUT = "Reply STOP to opt out.";

/** The text a person receives: the message with the office named first and the opt-out line last. */
export function renderSmsBody(body: string, values: Record<string, string>): string {
  const filled = body.replace(TOKEN, (_m, n: string) => clean(values[n] ?? "")).replace(/\r\n/g, "\n").trim();
  const named = new RegExp(`^${(values.office_name ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(filled) || !values.office_name ? filled : `${values.office_name}: ${filled}`;
  return /\bstop\b/i.test(named) ? named : `${named} ${SMS_OPT_OUT}`;
}
