// Email template rendering. Templates are plain text with {{variable}} placeholders from a fixed list.
// Everything is HTML-escaped; there is no expression evaluation, no includes and no raw HTML.

export const VARIABLES: Record<string, string> = {
  customer_name: "The customer's full name",
  customer_first_name: "The customer's first name",
  business_name: "The customer's business name (falls back to their name)",
  license_reference: "A partial license reference. The full key is never included",
  license_status: "Pending, active, suspended or revoked",
  tax_year: "The licensed tax year",
  order_number: "The order number",
  authorized_domain: "The website domain authorized for the calculator",
  setup_link: "A secure, expiring link to the customer's setup page",
  crm_status: "Whether a CRM is connected",
  crm_account: "The connected GoHighLevel account name",
  installation_status: "The calculator installation status",
  embed_instructions: "Step-by-step embed instructions with the calculator code",
  failure_reason: "A plain-language reason for a failed delivery",
  support_email: "Monarch Tax Suite support email",
  app_url: "The Monarch Tax Suite website address",
};
export const VARIABLE_NAMES = Object.keys(VARIABLES);

const TOKEN = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

export function variablesIn(...texts: string[]): string[] {
  const found = new Set<string>();
  for (const t of texts) for (const m of t.matchAll(TOKEN)) found.add(m[1]);
  return [...found];
}

/** Names used in the text that are not in the approved list. */
export function unknownVariables(...texts: string[]): string[] {
  return variablesIn(...texts).filter((v) => !Object.prototype.hasOwnProperty.call(VARIABLES, v));
}

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const clean = (v: string, max = 2000) => v.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").slice(0, max);
const oneLine = (v: string) => clean(v).replace(/\s+/g, " ").trim();

export type RenderedEmail = { subject: string; html: string; text: string };

const safeUrl = (v: string) => /^https:\/\/[^\s<>"']+$/.test(v);

function fill(text: string, values: Record<string, string>, mode: "text" | "html"): string {
  return text.replace(TOKEN, (_m, name: string) => {
    const raw = clean(values[name] ?? "");
    return mode === "html" ? esc(raw).replace(/\n/g, "<br>") : raw;
  });
}

/** Renders a template for one recipient. Throws on unknown variables so a typo can never reach a customer. */
export function renderTemplate(subjectTemplate: string, bodyTemplate: string, values: Record<string, string>, brand: { supportEmail: string }): RenderedEmail {
  const unknown = unknownVariables(subjectTemplate, bodyTemplate);
  if (unknown.length) throw new Error(`Unknown template variable(s): ${unknown.join(", ")}`);

  const subject = oneLine(fill(subjectTemplate, values, "text")).slice(0, 200);
  const blocks = bodyTemplate.replace(/\r\n/g, "\n").split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);

  const htmlBlocks = blocks.map((block) => {
    const only = block.match(/^\{\{\s*([A-Za-z0-9_]+)\s*\}\}$/)?.[1];
    if (only === "setup_link" && safeUrl(values.setup_link ?? "")) {
      const href = esc(values.setup_link);
      return `<p style="margin:24px 0"><a href="${href}" style="background:#111;color:#e8d9a8;text-decoration:none;padding:12px 22px;border-radius:4px;font-weight:600;display:inline-block">Open your setup page</a></p><p style="font-size:12px;color:#6b665a;word-break:break-all">Or copy this address: ${href}</p>`;
    }
    if (only === "embed_instructions") {
      return `<pre style="background:#f6f4ee;border:1px solid #e3dfd2;border-radius:4px;padding:12px;font-size:12px;white-space:pre-wrap;word-break:break-word">${esc(clean(values.embed_instructions ?? "", 4000))}</pre>`;
    }
    if (block.startsWith("# ")) return `<h2 style="font-size:20px;margin:0 0 12px;color:#111">${fill(block.slice(2), values, "html")}</h2>`;
    return `<p style="margin:0 0 14px;line-height:1.6">${fill(block, values, "html").replace(/\n/g, "<br>")}</p>`;
  });

  const text = blocks
    .map((block) => {
      const only = block.match(/^\{\{\s*([A-Za-z0-9_]+)\s*\}\}$/)?.[1];
      if (only === "embed_instructions") return clean(values.embed_instructions ?? "", 4000);
      return fill(block.startsWith("# ") ? block.slice(2) : block, values, "text");
    })
    .join("\n\n");

  const html = `<!doctype html><html><body style="margin:0;background:#f3f1ea;font-family:Arial,Helvetica,sans-serif;color:#2b2a26"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border:1px solid #e3dfd2;border-radius:6px"><tr><td style="background:#111;color:#e8d9a8;padding:16px 24px;font-size:13px;letter-spacing:2px;font-weight:700">MONARCH TAX SUITE</td></tr><tr><td style="padding:24px;font-size:15px">${htmlBlocks.join("")}</td></tr><tr><td style="padding:16px 24px;border-top:1px solid #eee;font-size:12px;color:#6b665a">Questions? Reply to this email or write to ${esc(brand.supportEmail)}.</td></tr></table></td></tr></table></body></html>`;
  return { subject, html, text: `${text}\n\n--\nMonarch Tax Suite · ${brand.supportEmail}` };
}

/** Sample values for previews and test sends. Obviously fake; never real customer data. */
export const SAMPLE_VALUES: Record<string, string> = {
  customer_name: "Sample Customer",
  customer_first_name: "Sample",
  business_name: "Sample Tax Co",
  license_reference: "MTS-SAMPL…",
  license_status: "active",
  tax_year: "2026",
  order_number: "1000",
  authorized_domain: "example-sample.com",
  setup_link: "https://monarch-tax-suite.vercel.app/setup?t=SAMPLE-LINK-NOT-REAL",
  crm_status: "Connected",
  crm_account: "Sample Tax Co (GoHighLevel)",
  installation_status: "active",
  embed_instructions: "SAMPLE: add a Custom Code block to your page and paste the calculator code shown in your setup page.",
  failure_reason: "SAMPLE: GoHighLevel access expired. Reconnect it from your setup page.",
  support_email: "info@monarchtaxsuite.com",
  app_url: "https://monarch-tax-suite.vercel.app",
};
