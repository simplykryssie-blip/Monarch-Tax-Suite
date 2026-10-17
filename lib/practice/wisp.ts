import { createHash, randomUUID } from "node:crypto";
import { ValidationError } from "../commerce/validation.ts";
import type { CrmSecrets } from "../crm/crypto.ts";
import type { DocumentStore } from "../documents/types.ts";
import { checkAnswers, WispInputError, type WispAnswers } from "../wisp/content.ts";
import { buildWispPdf } from "../wisp/pdf.ts";
import type { AuditInput } from "./service.ts";

// The independent PTIN holder's own WISP. They buy the $25 WISP product, build the plan for their own practice (the
// sole-practitioner wording), attest to it, and review it every year. Reminders come 30 and 7 days before the review
// is due and it shows Overdue after; nothing is ever locked. When the holder links to an ERO the record is archived
// as history, never deleted. Everything is in the holder's own tenant.

export type PracticeWispStatus = "draft" | "paid" | "active" | "archived";
export type PracticeWisp = {
  id: string; tenant_id: string; status: PracticeWispStatus; practice_name: string; holder_name: string; answers_sealed: string;
  stripe_session_id: string | null; paid_at: string | null; pdf_path: string | null; pdf_sha256: string | null; generated_at: string | null;
  attested_at: string | null; attested_name: string | null; review_due_on: string | null; reminder_30_sent_at: string | null; reminder_7_sent_at: string | null;
  archived_at: string | null; archived_reason: "linked_to_ero" | null; created_at: string; updated_at: string;
};

export interface PracticeWispRepo {
  /** The holder's live (not archived) WISP, if any. */
  getLive(): Promise<PracticeWisp | null>;
  list(): Promise<PracticeWisp[]>;
  findBySession(sessionId: string): Promise<PracticeWisp | null>;
  insert(input: Pick<PracticeWisp, "id" | "practice_name" | "holder_name" | "answers_sealed">): Promise<PracticeWisp>;
  update(id: string, patch: Partial<PracticeWisp>): Promise<PracticeWisp>;
}

export type PracticeWispDeps = {
  tenantId: string;
  repo: PracticeWispRepo;
  store: DocumentStore;
  secrets: CrmSecrets;
  brandName: () => Promise<string>;
  /** True while the holder has an active seat in an ERO's office (an active office_members row). */
  isLinked: () => Promise<boolean>;
  audit: (input: AuditInput) => Promise<void>;
  now?: () => Date;
};

export const REVIEW_MONTHS = 12;
export const REMINDER_DAYS = [30, 7] as const;
const nowOf = (d: { now?: () => Date }) => (d.now ? d.now() : new Date());
const fail = (m: string): never => { throw new ValidationError(m); };
const aad = (d: PracticeWispDeps, id: string) => `practice-wisp:${d.tenantId}:${id}`;
const day = (d: Date) => d.toISOString().slice(0, 10);

/** The same calendar day `months` later (a 29th of February becomes the 28th). */
export function addMonths(from: Date, months: number): Date {
  const y = from.getUTCFullYear(), m = from.getUTCMonth() + months, dd = from.getUTCDate();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(dd, last)));
}

export const openAnswers = (d: PracticeWispDeps, w: PracticeWisp): WispAnswers => JSON.parse(d.secrets.decrypt(w.answers_sealed, aad(d, w.id))) as WispAnswers;
export const fileNameOf = (w: Pick<PracticeWisp, "practice_name">) => `WISP-${w.practice_name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 60) || "plan"}.pdf`;

// ---------------------------------------------------------------- the review calendar

export type ReviewState = { state: "not_due" | "due_soon" | "overdue"; daysLeft: number };
/** Where an attested WISP stands. Overdue only describes it; nothing is locked. */
export function reviewState(w: Pick<PracticeWisp, "review_due_on">, at: Date): ReviewState | null {
  if (!w.review_due_on) return null;
  const daysLeft = Math.round((Date.parse(`${w.review_due_on}T00:00:00Z`) - Date.parse(`${day(at)}T00:00:00Z`)) / 86_400_000);
  return { daysLeft, state: daysLeft < 0 ? "overdue" : daysLeft <= REMINDER_DAYS[0] ? "due_soon" : "not_due" };
}

/**
 * Which reminder is owed now, if any: the 30-day one once the review is within 30 days, the 7-day one within 7. A
 * reminder is sent once; if the 30-day window was missed (say, the review was confirmed late), only the nearest one is.
 * Nothing is owed once it is overdue (the page shows Overdue) or for a WISP that isn't active.
 */
export function reminderOwed(w: PracticeWisp, at: Date): 30 | 7 | null {
  if (w.status !== "active") return null;
  const s = reviewState(w, at);
  if (!s || s.daysLeft < 0) return null;
  if (s.daysLeft <= REMINDER_DAYS[1] && !w.reminder_7_sent_at) return 7;
  if (s.daysLeft <= REMINDER_DAYS[0] && s.daysLeft > REMINDER_DAYS[1] && !w.reminder_30_sent_at) return 30;
  return null;
}

// ---------------------------------------------------------------- building and buying

async function liveOrNull(d: PracticeWispDeps) { return d.repo.getLive(); }

/** Keeps the holder's answers (sealed) as the draft of their WISP. They can be changed until the plan is attested. */
export async function saveDraft(d: PracticeWispDeps, actorId: string, holderName: string, rawAnswers: unknown): Promise<PracticeWisp> {
  if (await d.isLinked()) fail("You work in an ERO's office, so the office's WISP covers you. You don't need your own.");
  let answers: WispAnswers;
  try { answers = checkAnswers(rawAnswers); } catch (e) { throw e instanceof WispInputError ? new ValidationError(e.message) : e; }
  const live = await liveOrNull(d);
  if (live && (live.status === "active")) fail("Your WISP is already attested. Review it each year from this page.");
  if (live) {
    const sealed = d.secrets.encrypt(JSON.stringify(answers), aad(d, live.id));
    // Changed answers mean the generated file is out of date: it is made again.
    const saved = await d.repo.update(live.id, { practice_name: answers.firm_name, answers_sealed: sealed, pdf_path: null, pdf_sha256: null, generated_at: null });
    await d.audit({ actor_id: actorId, action: "wisp_draft_saved", subject_type: "practice_wisp", subject_id: live.id });
    return saved;
  }
  const id = randomUUID();
  const w = await d.repo.insert({ id, practice_name: answers.firm_name, holder_name: holderName, answers_sealed: d.secrets.encrypt(JSON.stringify(answers), aad(d, id)) });
  await d.audit({ actor_id: actorId, action: "wisp_draft_saved", subject_type: "practice_wisp", subject_id: w.id });
  return w;
}

export async function attachCheckout(d: PracticeWispDeps, id: string, sessionId: string): Promise<void> {
  await d.repo.update(id, { stripe_session_id: sessionId });
}

/**
 * Called by the signature-verified Stripe webhook once the WISP order is paid: the WISP this checkout was started
 * for becomes "paid". Safe to call again. Returns null when no WISP here belongs to this session.
 */
export async function markPaid(d: PracticeWispDeps, sessionId: string): Promise<PracticeWisp | null> {
  const w = await d.repo.findBySession(sessionId);
  if (!w) return null;
  if (w.status !== "draft") return w;
  const saved = await d.repo.update(w.id, { status: "paid", paid_at: nowOf(d).toISOString() });
  await d.audit({ actor_id: null, action: "wisp_paid", subject_type: "practice_wisp", subject_id: w.id });
  return saved;
}

/** Makes the plan's PDF (sole-practitioner wording) and files it in the holder's own documents. */
export async function generate(d: PracticeWispDeps, actorId: string): Promise<PracticeWisp> {
  const w = (await liveOrNull(d)) ?? fail("Build your WISP first.");
  if (w.status === "draft") fail("Buy the WISP first; it is generated once it's paid.");
  if (w.status === "active") return w;
  if (w.pdf_path) return w;
  const at = nowOf(d);
  const bytes = await buildWispPdf({ answers: openAnswers(d, w), brandName: await d.brandName(), generatedAt: at, planId: w.id, voice: "sole" });
  const path = `${d.tenantId}/wisp/practice-${w.id}.pdf`;
  await d.store.upload(path, bytes, "application/pdf").catch(async (e: unknown) => {
    if (!(e instanceof Error) || !/exist|duplicate/i.test(e.message)) throw e;
    await d.store.remove([path]);
    await d.store.upload(path, bytes, "application/pdf");
  });
  const saved = await d.repo.update(w.id, { pdf_path: path, pdf_sha256: createHash("sha256").update(bytes).digest("hex"), generated_at: at.toISOString() });
  await d.audit({ actor_id: actorId, action: "wisp_generated", subject_type: "practice_wisp", subject_id: w.id });
  return saved;
}

const same = (a: string, b: string) => a.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase() === b.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();

/** The holder adopts the generated plan: their typed name, the date, and the review due 12 months on. */
export async function attest(d: PracticeWispDeps, actorId: string, typedName: unknown): Promise<PracticeWisp> {
  const w = (await liveOrNull(d)) ?? fail("Build your WISP first.");
  if (w.status === "active") fail("Your WISP is already attested.");
  if (w.status !== "paid" || !w.pdf_path) fail("Generate your WISP and read it before attesting.");
  const name = typeof typedName === "string" ? typedName.trim() : "";
  if (!same(name, w.holder_name)) fail(`Type your name exactly as it appears here (${w.holder_name}) to attest.`);
  const at = nowOf(d);
  const saved = await d.repo.update(w.id, { status: "active", attested_at: at.toISOString(), attested_name: name, review_due_on: day(addMonths(at, REVIEW_MONTHS)), reminder_30_sent_at: null, reminder_7_sent_at: null });
  await d.audit({ actor_id: actorId, action: "wisp_attested", subject_type: "practice_wisp", subject_id: w.id, detail: { review_due_on: saved.review_due_on } });
  return saved;
}

/** The annual review: the holder confirms they've reviewed the plan; the next review is 12 months from today. */
export async function confirmReview(d: PracticeWispDeps, actorId: string, typedName: unknown): Promise<PracticeWisp> {
  const w = (await liveOrNull(d)) ?? fail("There's no WISP to review.");
  if (w.status !== "active") fail("Attest your WISP first.");
  const name = typeof typedName === "string" ? typedName.trim() : "";
  if (!same(name, w.holder_name)) fail(`Type your name exactly as it appears here (${w.holder_name}) to confirm the review.`);
  const at = nowOf(d);
  const saved = await d.repo.update(w.id, { attested_at: at.toISOString(), attested_name: name, review_due_on: day(addMonths(at, REVIEW_MONTHS)), reminder_30_sent_at: null, reminder_7_sent_at: null });
  await d.audit({ actor_id: actorId, action: "wisp_review_confirmed", subject_type: "practice_wisp", subject_id: w.id, detail: { review_due_on: saved.review_due_on } });
  return saved;
}

// ---------------------------------------------------------------- linking to an ERO

/**
 * Once the holder is linked to an ERO the office's WISP covers them: their own WISP is archived and kept as history
 * (never deleted). Safe to call any time; does nothing while they're independent or when there's nothing live.
 */
export async function archiveIfLinked(d: PracticeWispDeps, actorId: string | null): Promise<PracticeWisp | null> {
  const w = await liveOrNull(d);
  if (!w || !(await d.isLinked())) return null;
  const saved = await d.repo.update(w.id, { status: "archived", archived_at: nowOf(d).toISOString(), archived_reason: "linked_to_ero" });
  await d.audit({ actor_id: actorId, action: "wisp_archived", subject_type: "practice_wisp", subject_id: w.id, detail: { reason: "linked_to_ero", was: w.status } });
  return saved;
}

/** A 60-second link to the PDF, only inside this tenant's own folder. */
export async function downloadUrl(d: PracticeWispDeps, w: PracticeWisp, seconds = 60): Promise<string> {
  if (!w.pdf_path) fail("Your WISP hasn't been generated yet.");
  if (!w.pdf_path!.startsWith(`${d.tenantId}/wisp/`)) fail("Refused: that file is not in this workspace's folder.");
  return d.store.signedUrl(w.pdf_path!, seconds, fileNameOf(w));
}

export const reminderEmail = (input: { name: string; practice: string; days: 30 | 7; dueOn: string; link: string; brand: string }) => ({
  subject: `Your WISP review is due in ${input.days} days`,
  text: [
    `Hi ${input.name},`, "",
    `The annual review of the Written Information Security Plan for ${input.practice} is due on ${input.dueOn} (in ${input.days} days).`, "",
    `Review it and confirm here: ${input.link}`, "",
    "Reviewing takes a few minutes: read the plan, update anything that has changed, then confirm. If it isn't confirmed by the due date it shows as Overdue; nothing is locked.", "",
    input.brand,
  ].join("\n"),
});
