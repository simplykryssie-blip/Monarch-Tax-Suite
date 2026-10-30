import { createHash, randomBytes, randomUUID } from "node:crypto";
import { ValidationError } from "../commerce/validation.ts";
import type { CrmSecrets } from "../crm/crypto.ts";
import type { EmailAttachment } from "../automation/email.ts";
import type { DocumentStore } from "../documents/types.ts";
import { calculateScore, checkAnswers, checkAudit, checkEmail, DISCLAIMER, WispInputError, type WispAnswers } from "./content.ts";
import { buildWispPdf } from "./pdf.ts";

// The WISP Generator's backend for one tenant: lead capture from the audit, the builder's answers (sealed, they can
// include an EIN), the plan the $25 checkout pays for, the PDF made on the server and filed in the tenant's private
// documents, email delivery with the PDF attached, retries, and a logged history of every attempt and download.

export type WispAudit = { id: string; tenant_id: string; score: number; breakdown: Record<string, number>; answers: (number | null)[]; ero_answers: Record<string, string>; ip_hash: string | null; user_agent: string | null; created_at: string };
export type WispPlanStatus = "draft" | "paid" | "generated";
export type WispPlan = {
  id: string; tenant_id: string; audit_id: string | null; status: WispPlanStatus; firm_name: string; email: string; answers_sealed: string;
  access_token_hash: string; link_token_hash: string | null; link_expires_at: string | null; stripe_session_id: string | null;
  customer_id: string | null; order_id: string | null; pdf_path: string | null; pdf_sha256: string | null; generated_at: string | null;
  emailed_at: string | null; email_error: string | null; created_at: string; updated_at: string;
};
export type WispDelivery = { id: string; tenant_id: string; plan_id: string; kind: "email" | "download"; status: "sent" | "failed" | "held_back" | "downloaded"; actor: "system" | "buyer" | "admin"; detail: string | null; created_at: string };
export type WispActor = WispDelivery["actor"];

export interface WispRepo {
  insertAudit(input: Omit<WispAudit, "id" | "tenant_id" | "created_at">): Promise<WispAudit>;
  getAudit(id: string): Promise<WispAudit | null>;
  insertPlan(input: Pick<WispPlan, "id" | "audit_id" | "firm_name" | "email" | "answers_sealed" | "access_token_hash">): Promise<WispPlan>;
  getPlan(id: string): Promise<WispPlan | null>;
  findPlanBySession(sessionId: string): Promise<WispPlan | null>;
  findPlanByLinkHash(hash: string): Promise<WispPlan | null>;
  findPlanByOrder(orderId: string): Promise<WispPlan | null>;
  updatePlan(id: string, patch: Partial<WispPlan>): Promise<WispPlan>;
  listPlans(opts: { customerId?: string; limit: number }): Promise<WispPlan[]>;
  listAudits(limit: number): Promise<WispAudit[]>;
  addDelivery(input: Omit<WispDelivery, "id" | "tenant_id" | "created_at">): Promise<void>;
  listDeliveries(planId: string): Promise<WispDelivery[]>;
}

/** Sends one email. Null when sent; otherwise why not (a message starting "Not sent" means held back on purpose). */
export type WispMailer = (mail: { to: string; subject: string; html: string; text: string; idempotencyKey: string; attachments: EmailAttachment[] }) => Promise<string | null>;

export type WispDeps = {
  tenantId: string;
  repo: WispRepo;
  store: DocumentStore;
  secrets: CrmSecrets;
  send: WispMailer;
  /** The brand the buyer bought from: its name and the web address its links use. */
  brand: () => Promise<{ name: string; origin: string }>;
  /** Runs once a plan is paid (and again on Stripe's retries): links the buyer's lead to the order. Never blocks delivery. */
  onPaid?: (plan: WispPlan) => Promise<unknown>;
  /**
   * Issues the license key for the license this plan's order created, and returns it (it is shown once, in the "plan is
   * ready" email). Null when there is no usable license. Called only while no email has gone out yet, so a plan that is
   * emailed again never changes the buyer's key.
   */
  issueKey?: (plan: WispPlan) => Promise<string | null>;
  now?: () => Date;
};

export const LINK_DAYS = 365;
export const DOWNLOAD_SECONDS = 60;
export const RESEND_WAIT_SECONDS = 120;

const nowOf = (deps: WispDeps) => deps.now?.() ?? new Date();
export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");
const aad = (deps: WispDeps, planId: string) => `wisp:${deps.tenantId}:${planId}`;
const asInput = (e: unknown) => (e instanceof WispInputError ? new ValidationError(e.message) : e);

// ------------------------------------------------------------------ leads

/** Records a finished audit (lead capture). Returns its id and the score computed on the server. */
export async function recordAudit(deps: WispDeps, raw: { answers: unknown; ero: unknown }, who: { ipHash: string | null; userAgent: string | null }) {
  const { answers, ero } = checkAudit(raw.answers, raw.ero);
  const { score, breakdown } = calculateScore(answers);
  const audit = await deps.repo.insertAudit({ score, breakdown, answers, ero_answers: ero, ip_hash: who.ipHash, user_agent: who.userAgent });
  return { auditId: audit.id, score, breakdown };
}

/**
 * Saves the builder's answers and delivery email as a plan before payment (so a visitor who doesn't pay is still a
 * lead). Returns the plan and a secret that lets this browser follow the plan to its download.
 */
export async function startPlan(deps: WispDeps, raw: { answers: unknown; email: unknown; auditId?: unknown }): Promise<{ plan: WispPlan; accessToken: string }> {
  let answers: WispAnswers;
  let email: string;
  try {
    answers = checkAnswers(raw.answers);
    email = checkEmail(raw.email);
  } catch (e) {
    throw asInput(e);
  }
  const auditId = typeof raw.auditId === "string" && /^[0-9a-f-]{36}$/.test(raw.auditId) && (await deps.repo.getAudit(raw.auditId)) ? raw.auditId : null;
  const id = randomUUID();
  const accessToken = newToken();
  const plan = await deps.repo.insertPlan({
    id, audit_id: auditId, firm_name: answers.firm_name, email,
    answers_sealed: deps.secrets.encrypt(JSON.stringify(answers), aad(deps, id)),
    access_token_hash: hashToken(accessToken),
  });
  return { plan, accessToken };
}

export const openAnswers = (deps: WispDeps, plan: WispPlan): WispAnswers => JSON.parse(deps.secrets.decrypt(plan.answers_sealed, aad(deps, plan.id))) as WispAnswers;

export async function attachCheckout(deps: WispDeps, planId: string, sessionId: string) {
  await deps.repo.updatePlan(planId, { stripe_session_id: sessionId });
}

// ------------------------------------------------------------------ after payment

/**
 * Called by the signature-verified Stripe webhook once the WISP order is paid: links the plan to the customer and
 * order, then makes the PDF and emails it. Safe to call again (Stripe retries); a failed email is retried later.
 */
export async function fulfilPaidPlan(deps: WispDeps, input: { sessionId: string; planId?: string | null; customerId: string; orderId: string }): Promise<WispPlan | null> {
  let plan = await deps.repo.findPlanBySession(input.sessionId);
  if (!plan && input.planId) {
    const byId = await deps.repo.getPlan(input.planId);
    // Only the plan this checkout was started for.
    if (byId && byId.stripe_session_id === input.sessionId) plan = byId;
  }
  if (!plan) return null;
  if (plan.status === "draft" || !plan.order_id) plan = await deps.repo.updatePlan(plan.id, { status: plan.status === "generated" ? "generated" : "paid", customer_id: input.customerId, order_id: input.orderId });
  if (deps.onPaid) await deps.onPaid(plan).catch((e: unknown) => console.error(`wisp: linking the lead failed: ${e instanceof Error ? e.message.slice(0, 160) : "unknown"}`));
  return deliver(deps, plan, "system");
}

/** Makes the PDF if it isn't made yet, then emails it if it hasn't been emailed. */
export async function deliver(deps: WispDeps, plan: WispPlan, actor: WispActor): Promise<WispPlan> {
  if (plan.status === "draft") throw new ValidationError("This WISP hasn't been paid for yet.");
  let current = await ensureGenerated(deps, plan);
  if (!current.emailed_at) current = await sendPlanEmail(deps, current, actor);
  return current;
}

export async function ensureGenerated(deps: WispDeps, plan: WispPlan): Promise<WispPlan> {
  if (plan.pdf_path && plan.status === "generated") return plan;
  if (plan.status === "draft") throw new ValidationError("This WISP hasn't been paid for yet.");
  const brand = await deps.brand();
  const at = nowOf(deps);
  const bytes = await buildWispPdf({ answers: openAnswers(deps, plan), brandName: brand.name, generatedAt: at, planId: plan.id });
  const path = `${deps.tenantId}/wisp/${plan.id}.pdf`;
  // A retry after a half-finished attempt replaces the file it left.
  await deps.store.upload(path, bytes, "application/pdf").catch(async (e: unknown) => {
    if (!(e instanceof Error) || !/exist|duplicate/i.test(e.message)) throw e;
    await deps.store.remove([path]);
    await deps.store.upload(path, bytes, "application/pdf");
  });
  return deps.repo.updatePlan(plan.id, { status: "generated", pdf_path: path, pdf_sha256: createHash("sha256").update(bytes).digest("hex"), generated_at: at.toISOString() });
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export const pdfFileName = (plan: Pick<WispPlan, "firm_name">) => `WISP-${plan.firm_name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 60) || "plan"}.pdf`;

/** Where a license holder opens their plan again, with the license key. */
export const downloadsUrl = (origin: string) => `${origin.replace(/\/$/, "")}/downloads`;

/**
 * Emails the "your plan is ready" notice. The plan itself is not attached: it is filed on the buyer's license, and the
 * notice carries the license key and the page that opens it. The first notice carries the key; a later one does not
 * (the key would change), and points the buyer back to the first. Every attempt is logged.
 */
export async function sendPlanEmail(deps: WispDeps, plan: WispPlan, actor: WispActor): Promise<WispPlan> {
  const current = await ensureGenerated(deps, plan);
  const brand = await deps.brand();
  const first = !current.emailed_at;
  const key = first && deps.issueKey ? await deps.issueKey(current).catch((e: unknown) => { console.error(`wisp: issuing the license key failed: ${e instanceof Error ? e.message.slice(0, 160) : "unknown"}`); return null; }) : null;
  const link = downloadsUrl(brand.origin);
  const keyText = key
    ? `Your license key: ${key}\nKeep this email. The key opens your plan, and it is only shown here.`
    : first
      ? "Your license key will follow from our team. Reply to this email if you do not hear from us."
      : "Use the license key from your first WISP email. If you have lost it, reply to this email and we will issue a new one.";
  const text = [
    `Your Written Information Security Plan for ${current.firm_name} is ready. It is not attached to this email: it is filed on your license, and you can view or download it again at any time.`,
    "",
    `Open it here: ${link}`,
    keyText,
    "",
    "Keep it somewhere safe, review it every year, and update it when your systems, staff or risks change.",
    "",
    DISCLAIMER,
    "",
    brand.name,
  ].join("\n");
  const keyHtml = key
    ? `<p>Your license key: <b style="font-family:monospace">${esc(key)}</b><br>Keep this email. The key opens your plan, and it is only shown here.</p>`
    : `<p>${esc(keyText)}</p>`;
  const html = `<p>Your Written Information Security Plan for <b>${esc(current.firm_name)}</b> is ready. It is not attached to this email: it is filed on your license, and you can view or download it again at any time.</p>
<p><a href="${esc(link)}">Open your plan</a></p>
${keyHtml}
<p>Keep it somewhere safe, review it every year, and update it when your systems, staff or risks change.</p>
<p style="color:#666;font-size:12px">${esc(DISCLAIMER)}</p><p>${esc(brand.name)}</p>`;
  const problem = await deps.send({
    to: current.email, subject: `Your WISP for ${current.firm_name} is ready`, html, text,
    idempotencyKey: `wisp:${current.id}:${key ? hashToken(key).slice(0, 16) : randomUUID().slice(0, 8)}`,
    attachments: [],
  }).catch((e: unknown) => (e instanceof Error ? e.message : "The email could not be sent.").slice(0, 300));
  const heldBack = !!problem && problem.startsWith("Not sent");
  await deps.repo.addDelivery({ plan_id: current.id, kind: "email", status: problem ? (heldBack ? "held_back" : "failed") : "sent", actor, detail: problem ? problem.slice(0, 480) : `to ${current.email}${key ? ", with the license key" : ""}` });
  if (problem) return deps.repo.updatePlan(current.id, { email_error: problem.slice(0, 480) });
  return deps.repo.updatePlan(current.id, { emailed_at: nowOf(deps).toISOString(), email_error: null });
}

/** The buyer's "send it again" button: not more than once every two minutes. */
export async function resendForBuyer(deps: WispDeps, plan: WispPlan): Promise<WispPlan> {
  if (plan.status === "draft") throw new ValidationError("This WISP hasn't been paid for yet.");
  const last = (await deps.repo.listDeliveries(plan.id)).find((d) => d.kind === "email");
  if (last && nowOf(deps).getTime() - Date.parse(last.created_at) < RESEND_WAIT_SECONDS * 1000) throw new ValidationError("We just tried to send it. Please wait two minutes before trying again, or download it below.");
  return sendPlanEmail(deps, plan, "buyer");
}

// ------------------------------------------------------------------ access

/** The plan this browser started, if its secret matches. */
export async function planForBuyer(deps: WispDeps, planId: string, token: string): Promise<WispPlan | null> {
  if (!/^[0-9a-f-]{36}$/.test(planId) || !token) return null;
  const plan = await deps.repo.getPlan(planId);
  return plan && plan.access_token_hash === hashToken(token) ? plan : null;
}

/** The plan an emailed link points at, while the link is valid. */
export async function planForLink(deps: WispDeps, token: string): Promise<WispPlan | null> {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const plan = await deps.repo.findPlanByLinkHash(hashToken(token));
  if (!plan || !plan.link_expires_at || Date.parse(plan.link_expires_at) < nowOf(deps).getTime()) return null;
  return plan;
}

/** A 60-second link to the PDF, logged. Never for another tenant's file. */
export async function downloadUrl(deps: WispDeps, plan: WispPlan, actor: WispActor): Promise<string> {
  const ready = await ensureGenerated(deps, plan);
  if (!ready.pdf_path!.startsWith(`${deps.tenantId}/wisp/`)) throw new ValidationError("Refused: that file is not in this tenant's folder.");
  await deps.repo.addDelivery({ plan_id: ready.id, kind: "download", status: "downloaded", actor, detail: null });
  return deps.store.signedUrl(ready.pdf_path!, DOWNLOAD_SECONDS, pdfFileName(ready));
}
