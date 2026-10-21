import { PLATFORM } from "../platform-brand.ts";

// Plain-text emails (one paragraph per line) become simple HTML. A line that is a web address becomes a link; the line that
// is the email's main action becomes a real button instead of a long address.

export type EmailAction = { label: string; url: string };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const safeUrl = (u: string) => /^https?:\/\/[^\s"<>]+$/.test(u);

export function emailButton(action: EmailAction): string {
  if (!safeUrl(action.url)) return "";
  const href = esc(action.url);
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0"><tr><td style="background:#2563eb;border-radius:8px"><a href="${href}" style="display:inline-block;padding:13px 26px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px">${esc(action.label)}</a></td></tr></table>`;
}

export function renderEmailHtml(text: string, action?: EmailAction | null): string {
  const body = text.split("\n").map((line) => {
    if (action && line.trim() === action.url) return emailButton(action);
    if (/^https?:\/\//.test(line)) return `<p><a href="${esc(line)}">${esc(line)}</a></p>`;
    return line ? `<p style="margin:0 0 12px">${esc(line)}</p>` : "";
  }).join("");
  if (!action) return body;
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#111827;max-width:520px"><div style="font-size:13px;font-weight:700;letter-spacing:2px;color:#2563eb;margin-bottom:16px">${esc(PLATFORM.eyebrow)}</div>${body}</div>`;
}
