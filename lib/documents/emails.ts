import { esc } from "../automation/template.ts";

// Emails about documents. Plain, escaped text only; the one link is the secure document link.

export type BuiltEmail = { subject: string; html: string; text: string };

const clean = (v: string, max = 2000) => v.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").slice(0, max).trim();
export const oneLine = (v: string, max = 200) => clean(v, max).replace(/\s+/g, " ");

export function layout(firm: string, paragraphs: string[], button: { label: string; url: string } | null, footer: string): BuiltEmail {
  const html = [
    `<div style="font-family:Arial,Helvetica,sans-serif;color:#111;max-width:560px;margin:0 auto;padding:24px">`,
    `<p style="font-size:13px;color:#6b665a;margin:0 0 18px">${esc(oneLine(firm, 120))}</p>`,
    ...paragraphs.map((p) => `<p style="margin:0 0 14px;line-height:1.6">${esc(clean(p)).replace(/\n/g, "<br>")}</p>`),
    button ? `<p style="margin:24px 0"><a href="${esc(button.url)}" style="background:#111;color:#e8d9a8;text-decoration:none;padding:12px 22px;border-radius:4px;font-weight:600;display:inline-block">${esc(button.label)}</a></p><p style="font-size:12px;color:#6b665a;word-break:break-all">Or copy this address: ${esc(button.url)}</p>` : "",
    `<p style="font-size:12px;color:#6b665a;margin-top:24px">${esc(footer)}</p>`,
    `</div>`,
  ].join("");
  const text = [...paragraphs.map((p) => clean(p)), ...(button ? [`${button.label}: ${button.url}`] : []), footer].join("\n\n");
  return { subject: "", html, text };
}

const expires = (at: Date) => new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(at);

export function documentEmail(input: { kind: "send" | "signature"; firmName: string; documentName: string; clientFirstName: string | null; message: string; url: string; expiresAt: Date; reminder?: boolean }): BuiltEmail {
  const greet = input.clientFirstName ? `Hello ${input.clientFirstName},` : "Hello,";
  const lead = input.kind === "signature"
    ? `${input.reminder ? "A reminder: " : ""}${input.firmName} has asked you to review and sign "${input.documentName}".`
    : `${input.firmName} has sent you "${input.documentName}".`;
  const body = layout(
    input.firmName,
    [greet, lead, ...(input.message.trim() ? [input.message] : []), `This secure link is personal to you and works until ${expires(input.expiresAt)}.`],
    { label: input.kind === "signature" ? "Review and sign" : "View the document", url: input.url },
    "If you were not expecting this, you can ignore this email.",
  );
  const subject = input.kind === "signature"
    ? `${input.reminder ? "Reminder: " : ""}Please sign: ${input.documentName}`
    : `${input.firmName} sent you a document: ${input.documentName}`;
  return { ...body, subject: oneLine(subject) };
}

export function signedConfirmationEmail(input: { firmName: string; documentName: string; signerName: string; url: string }): BuiltEmail {
  const body = layout(
    input.firmName,
    [`Hello ${input.signerName},`, `You signed "${input.documentName}". A copy of the signed document, with its signing certificate, is available for 30 days.`],
    { label: "Download the signed copy", url: input.url },
    `Sent on behalf of ${input.firmName}.`,
  );
  return { ...body, subject: oneLine(`Signed: ${input.documentName}`) };
}

export function firmNoticeEmail(input: { firmName: string; outcome: "signed" | "declined" | "expired"; documentName: string; clientName: string; clientEmail: string; reason?: string | null; adminUrl: string }): BuiltEmail {
  const what = input.outcome === "signed" ? "signed" : input.outcome === "declined" ? "declined to sign" : "did not sign before the link expired:";
  const body = layout(
    input.firmName,
    [`${input.clientName} (${input.clientEmail}) ${what} "${input.documentName}".`, ...(input.reason ? [`Reason given: ${input.reason}`] : [])],
    { label: "Open the document", url: input.adminUrl },
    "Automatic notice from your document workflows.",
  );
  return { ...body, subject: oneLine(`${input.outcome === "signed" ? "Signed" : input.outcome === "declined" ? "Declined" : "Expired"}: ${input.documentName} (${input.clientName})`) };
}
