import { createHash, randomBytes } from "node:crypto";
import { hashLicenseKey, isWellFormedLicenseKey } from "../commerce/license-keys.ts";
import { normalizeEmail, ValidationError } from "../commerce/validation.ts";
import { compute, LINE_KEYS, n, normalizeReturn, rejectCount, type LineKey, type TaxReturn } from "./engine.ts";
import { labProductSettings } from "./product.ts";
export { DELIVERY, labProductBlockers, labProductSettings } from "./product.ts";
import {
  DOC_OPTIONS, LAB_LEVELS, type DocOptions, type Fact, type LabCommercePort, type LabKey, type LabKind, type LabMember,
  type LabRepo, type LabScenario, type LabTerms, type LabWork, type SourceDocs,
} from "./types.ts";

// Monarch Tax Lab rules. Everything here is framework-free and checked by tests/lab-service.test.ts.
//
// Access: a training license is a calculator_licenses row of a product whose settings say delivery = "tax_lab". The
// buyer activates its key once; that records the terms (instructor or student license, seats, end date) and makes
// the buyer the license's first member. Instructors invite students into their seats. Monarch administrators write
// the shared library. Answer keys stay on the server: students get only "this line matches / does not match".

const INVITE_DAYS = 30;
const DAY = 86_400_000;

export type Membership = { member: LabMember; terms: LabTerms };
/** Who is using the lab right now. A Monarch administrator may have no membership and still author the library. */
export type LabContext = { userId: string; email: string; isAdmin: boolean; membership: Membership | null };

const clean = (s: unknown, max: number) => String(s ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max);

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Whether a license's training access is current. */
export function termsActive(terms: LabTerms | null, now: Date): boolean {
  return Boolean(terms) && Date.parse(terms!.starts_at) <= now.getTime() && now.getTime() < Date.parse(terms!.expires_at);
}

// ------------------------------------------------------------------ access

/** The memberships this person can use now: active, on a license whose training terms are current. Instructors first. */
export async function activeMemberships(repo: LabRepo, userId: string, now: Date): Promise<Membership[]> {
  const out: Membership[] = [];
  for (const member of await repo.membersForUser(userId)) {
    if (member.status !== "active") continue;
    const terms = await repo.getTerms(member.license_id);
    if (terms && termsActive(terms, now)) out.push({ member, terms });
  }
  return out.sort((a, b) => (a.member.role === b.member.role ? 0 : a.member.role === "instructor" ? -1 : 1));
}

export type ActivateInput = { rawKey: string; userId: string; email: string; displayName: string | null; now: Date };

/**
 * Activates a training license key for this account. Safe to repeat by the same person. A key already activated by
 * someone else is refused (the buyer can contact Monarch to move it).
 */
export async function activateKey(repo: LabRepo, commerce: LabCommercePort, input: ActivateInput): Promise<Membership> {
  if (!isWellFormedLicenseKey(input.rawKey)) throw new ValidationError("Enter your license key (MTS-XXXXX-XXXXX-XXXXX-XXXXX).");
  const license = await commerce.findLicenseByKeyHash(hashLicenseKey(input.rawKey));
  const product = license ? await commerce.getProduct(license.product_id) : null;
  const settings = labProductSettings(product?.metadata);
  if (!license || !product || !settings) throw new ValidationError("That key is not a Monarch Tax Lab license. Check the key in your purchase email.");
  if (license.status !== "active") throw new ValidationError("This license is not active. Contact Monarch Tax Suite for help.");
  const existing = await repo.getTerms(license.id);
  if (existing) {
    const mine = (await repo.membersOfLicense(license.id)).find((m) => m.user_id === input.userId && m.status === "active" && m.role === existing.kind);
    if (mine) return { member: mine, terms: existing };
    throw new ValidationError("This license key has already been activated by another account. Contact Monarch Tax Suite if it should be moved to you.");
  }
  const start = input.now.toISOString();
  const terms = await repo.createTerms({
    license_id: license.id,
    kind: settings.kind,
    seats: settings.seats,
    activated_by: input.userId,
    starts_at: start,
    expires_at: new Date(input.now.getTime() + settings.termDays * DAY).toISOString(),
  });
  const member = await repo.createMember({
    license_id: license.id,
    user_id: input.userId,
    email: normalizeEmail(input.email),
    display_name: clean(input.displayName, 120) || null,
    role: settings.kind,
    status: "active",
    invite_token_hash: null,
    invite_expires_at: null,
    joined_at: start,
  });
  return { member, terms };
}

export function seatsUsed(members: LabMember[]): number {
  return members.filter((m) => m.role === "student" && m.status !== "removed").length;
}

/** Instructors invite students by email. Each invite holds a seat. Returns the one-time join links' tokens. */
export async function inviteStudents(repo: LabRepo, ms: Membership, rawEmails: string, now: Date): Promise<{ email: string; token: string }[]> {
  if (ms.member.role !== "instructor") throw new ValidationError("Only instructors can invite students.");
  const wanted = [...new Set(rawEmails.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (!wanted.length) throw new ValidationError("Enter at least one student email address.");
  const emails = wanted.map((e) => normalizeEmail(e));
  const members = await repo.membersOfLicense(ms.member.license_id);
  const taken = new Set(members.filter((m) => m.status !== "removed").map((m) => m.email.toLowerCase()));
  const fresh = emails.filter((e) => !taken.has(e));
  if (!fresh.length) throw new ValidationError("Those students are already on your roster.");
  const free = ms.terms.seats - seatsUsed(members);
  if (fresh.length > free) throw new ValidationError(`Your license has ${free} open seat${free === 1 ? "" : "s"}. Remove a student or upgrade your license to add more.`);
  const out: { email: string; token: string }[] = [];
  for (const email of fresh) {
    const token = newToken();
    await repo.createMember({
      license_id: ms.member.license_id, user_id: null, email, display_name: null, role: "student", status: "invited",
      invite_token_hash: hashToken(token), invite_expires_at: new Date(now.getTime() + INVITE_DAYS * DAY).toISOString(), joined_at: null,
    });
    out.push({ email, token });
  }
  return out;
}

/** A fresh join link for an invited student (the old one stops working). */
export async function reissueInvite(repo: LabRepo, ms: Membership, memberId: string, now: Date): Promise<string> {
  const m = await repo.getMember(memberId);
  if (ms.member.role !== "instructor" || !m || m.license_id !== ms.member.license_id || m.status !== "invited") throw new ValidationError("That student has already joined or was removed.");
  const token = newToken();
  await repo.updateMember(m.id, { invite_token_hash: hashToken(token), invite_expires_at: new Date(now.getTime() + INVITE_DAYS * DAY).toISOString() });
  return token;
}

export async function removeStudent(repo: LabRepo, ms: Membership, memberId: string): Promise<void> {
  const m = await repo.getMember(memberId);
  if (ms.member.role !== "instructor" || !m || m.license_id !== ms.member.license_id || m.role !== "student") throw new ValidationError("Student not found.");
  await repo.updateMember(m.id, { status: "removed", invite_token_hash: null, invite_expires_at: null });
}

/** Looks up an invite without using it (for the join page). */
export async function inviteFor(repo: LabRepo, rawToken: string, now: Date): Promise<{ member: LabMember; terms: LabTerms } | null> {
  if (!rawToken || rawToken.length > 100) return null;
  const member = await repo.memberByInviteHash(hashToken(rawToken));
  if (!member || member.status !== "invited" || !member.invite_expires_at || Date.parse(member.invite_expires_at) <= now.getTime()) return null;
  const terms = await repo.getTerms(member.license_id);
  return terms && termsActive(terms, now) ? { member, terms } : null;
}

/** The invited student joins with the account they are signed in to. The link works once. */
export async function acceptInvite(repo: LabRepo, rawToken: string, user: { id: string; email: string; displayName: string | null }, now: Date): Promise<LabMember> {
  const found = await inviteFor(repo, rawToken, now);
  if (!found) throw new ValidationError("This invitation link has expired or was already used. Ask your instructor for a new link.");
  const already = (await repo.membersOfLicense(found.member.license_id)).find((m) => m.user_id === user.id && m.status !== "removed");
  if (already) {
    await repo.updateMember(found.member.id, { status: "removed", invite_token_hash: null });
    return already;
  }
  return repo.updateMember(found.member.id, {
    user_id: user.id, status: "active", joined_at: now.toISOString(), invite_token_hash: null, invite_expires_at: null,
    display_name: clean(user.displayName, 120) || found.member.display_name,
  });
}

// ------------------------------------------------------------------ scenarios

export function canEditScenario(ctx: LabContext, s: Pick<LabScenario, "license_id">): boolean {
  if (s.license_id === null) return ctx.isAdmin;
  return ctx.membership?.member.role === "instructor" && ctx.membership.member.license_id === s.license_id;
}

export function canViewScenario(ctx: LabContext, s: Pick<LabScenario, "license_id" | "status">): boolean {
  if (canEditScenario(ctx, s)) return true;
  if (s.status !== "published") return false;
  if (s.license_id === null) return Boolean(ctx.membership) || ctx.isAdmin;
  return ctx.membership?.member.license_id === s.license_id;
}

export async function visibleScenarios(repo: LabRepo, ctx: LabContext): Promise<LabScenario[]> {
  const ids = ctx.membership ? [ctx.membership.member.license_id] : [];
  return (await repo.listScenarios(ids)).filter((s) => canViewScenario(ctx, s)).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

/** Practice copies of the client's documents, built from the answer key's entries and the instructor's choices. */
export function buildSourceDocs(input: unknown, options: DocOptions): SourceDocs {
  const R = normalizeReturn(input);
  const name = (p: { first: string; last: string }) => `${p.first} ${p.last}`.trim();
  const tp = name(R.tp);
  const sp = name(R.sp);
  const who = (w: string | undefined) => (w === "sp" ? sp : tp);
  const out: SourceDocs = {};
  if (options.household) {
    const person = (role: string, p: typeof R.tp) => ({ role, name: name(p), info: [p.ssn ? `SSN ${p.ssn}` : "", p.age ? `age ${p.age}` : "", p.occupation].filter(Boolean).join(" · ") });
    out.household = [person("Taxpayer", R.tp)];
    if (R.fs === "mfj" || R.fs === "mfs") out.household.push(person("Spouse", R.sp));
    for (const d of R.deps) {
      out.household.push({
        role: d.rel || "Household member", name: d.name,
        info: [d.ssnNum ? `SSN ${d.ssnNum}` : d.ssn === false ? "no SSN" : "", `age ${d.age || "?"} at year end`, `in the home ${d.months || "?"} months`, d.student ? "full-time student" : "", d.disabled ? "disabled" : ""].filter(Boolean).join(" · "),
      });
    }
  }
  if (options.w2) out.w2 = R.w2.map((w) => ({ employer: w.employer, ein: w.ein, employee: who(w.who), ssn: w.who === "sp" ? R.sp.ssn : R.tp.ssn, wages: n(w.wages), fedwh: n(w.fedwh) }));
  if (options.int) out.int = R.int.map((x) => ({ payer: x.payer, recipient: tp, amt: n(x.amt), fedwh: n(x.fedwh), exempt: n(x.exempt) }));
  if (options.div) out.div = R.div.map((x) => ({ payer: x.payer, recipient: tp, ord: n(x.ord), qual: n(x.qual), capd: n(x.capd), fedwh: n(x.fedwh) }));
  if (options.g) out.g = R.g.map((x) => ({ payer: x.payer, recipient: tp, unemp: n(x.unemp), fedwh: n(x.fedwh) }));
  if (options.r) out.r = R.r.map((x) => ({ payer: x.payer, recipient: tp, gross: n(x.gross), taxable: x.taxable === "" ? null : n(x.taxable), fedwh: n(x.fedwh), code: x.code, ira: Boolean(x.ira) }));
  if (options.ssa) out.ssa = R.ssa.map((x) => ({ recipient: who(x.who), net: n(x.net), fedwh: n(x.fedwh) }));
  if (options.nec) out.nec = R.schc.filter((b) => n(b.nec) > 0).map((b) => ({ payer: b.necPayer ?? "", recipient: who(b.who), amt: n(b.nec) }));
  return out;
}

export type ScenarioForm = {
  id: string | null;
  scope: "library" | "license";
  status: "draft" | "published";
  title: string;
  level: string;
  summary: string;
  narrative: string;
  factsText: string;
  intakeMode: string;
  docOptions: DocOptions;
  ret: unknown;
  checks: string[];
  overrides: Record<string, string>;
};

export function parseFacts(text: string): Fact[] {
  return text.split("\n").map((line) => {
    const i = line.indexOf(":");
    if (i > 0) return { label: clean(line.slice(0, i), 80), value: clean(line.slice(i + 1), 400) };
    const v = clean(line, 400);
    return v ? { label: "Note", value: v } : null;
  }).filter((f): f is Fact => Boolean(f && f.label && f.value)).slice(0, 40);
}

/** Creates or updates a scenario and its answer key. The key's line values are computed here, on the server. */
export async function saveScenario(repo: LabRepo, ctx: LabContext, form: ScenarioForm, now: Date): Promise<LabScenario> {
  const existing = form.id ? await repo.getScenario(form.id) : null;
  if (form.id && !existing) throw new ValidationError("Scenario not found.");
  const licenseId = existing ? existing.license_id : form.scope === "library" ? null : ctx.membership?.member.license_id ?? null;
  if (!existing && form.scope === "license" && !licenseId) throw new ValidationError("Only instructors can write class scenarios.");
  if (!canEditScenario(ctx, { license_id: licenseId })) throw new ValidationError("You can't edit this scenario.");
  const title = clean(form.title, 160);
  if (!title) throw new ValidationError("Add a scenario title.");
  const checks = form.checks.filter((k): k is LineKey => (LINE_KEYS as string[]).includes(k));
  if (form.status === "published" && !checks.length) throw new ValidationError("Pick at least one line for students to match before publishing.");
  const ret: TaxReturn = normalizeReturn(form.ret);
  const lines = compute(ret).lines;
  const overrides: Partial<Record<LineKey, number>> = {};
  const values: Partial<Record<LineKey, number>> = {};
  for (const k of LINE_KEYS) {
    const raw = form.overrides[k];
    if (raw !== undefined && String(raw).trim() !== "") overrides[k] = Math.round(n(raw));
    values[k] = overrides[k] ?? lines[k];
  }
  const docOptions: DocOptions = {};
  for (const [k] of DOC_OPTIONS) docOptions[k] = Boolean(form.docOptions[k]);
  const scenario = await repo.saveScenario({
    id: existing?.id ?? form.id ?? cryptoId(),
    license_id: licenseId,
    tax_year: 2026,
    status: form.status === "published" ? "published" : "draft",
    title,
    level: (LAB_LEVELS as readonly string[]).includes(form.level) ? (form.level as LabScenario["level"]) : "Beginner",
    summary: clean(form.summary, 300) || null,
    narrative: String(form.narrative ?? "").replace(/\r\n/g, "\n").slice(0, 20000),
    facts: parseFacts(form.factsText ?? ""),
    intake_mode: form.intakeMode === "interview" ? "interview" : "notes",
    doc_options: docOptions,
    documents: buildSourceDocs(ret, docOptions),
    created_by: existing?.created_by ?? ctx.userId,
  });
  await repo.saveKey({ scenario_id: scenario.id, ret, line_values: values, overrides, checks, updated_at: now.toISOString() });
  return scenario;
}

function cryptoId(): string {
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** What a student sees about a scenario. The answer key is never part of it. */
export type StudentScenario = Omit<LabScenario, "narrative" | "facts"> & { narrative: string | null; facts: Fact[] | null; checkCount: number };

export function studentView(s: LabScenario, key: LabKey | null, canSeeNotes: boolean): StudentScenario {
  const notes = canSeeNotes || s.intake_mode === "notes";
  return { ...s, narrative: notes ? s.narrative : null, facts: notes ? s.facts : null, checkCount: key?.checks.length ?? 0 };
}

// ------------------------------------------------------------------ work

export type LineResult = { k: LineKey; value: number; pass: boolean };

/** Compares a return with the answer key on the key's checked lines. Whole dollars. */
export function checkAgainstKey(key: LabKey, ret: unknown): { results: LineResult[]; correct: number; total: number } {
  const lines = compute(ret).lines;
  const results = key.checks.map((k) => ({ k, value: lines[k], pass: Math.round(lines[k]) === Math.round(n(key.line_values[k])) }));
  return { results, correct: results.filter((r) => r.pass).length, total: results.length };
}

function sanitizeIntake(input: unknown): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  if (typeof input !== "object" || input === null) return out;
  for (const [k, v] of Object.entries(input as Record<string, unknown>).slice(0, 80)) {
    if (!/^[a-z_]{1,30}$/.test(k)) continue;
    if (typeof v === "boolean") out[k] = v;
    else if (typeof v === "string") out[k] = v.slice(0, 4000);
  }
  return out;
}

async function requireStudentAccess(repo: LabRepo, ctx: LabContext, scenarioId: string): Promise<{ ms: Membership; scenario: LabScenario }> {
  const ms = ctx.membership;
  if (!ms) throw new ValidationError("Activate a license to practice.");
  const scenario = await repo.getScenario(scenarioId);
  if (!scenario || !canViewScenario(ctx, scenario)) throw new ValidationError("Scenario not found.");
  return { ms, scenario };
}

export async function saveDraft(repo: LabRepo, ctx: LabContext, scenarioId: string, ret: unknown, intake: unknown): Promise<LabWork> {
  const { ms } = await requireStudentAccess(repo, ctx, scenarioId);
  const json = JSON.stringify(ret ?? {});
  if (json.length > 200_000) throw new ValidationError("This return is too large to save.");
  return repo.saveWork({ member_id: ms.member.id, scenario_id: scenarioId, ret: normalizeReturn(ret) as unknown as Record<string, unknown>, intake: sanitizeIntake(intake) });
}

/** Runs the check: saves the draft, counts the attempt, and returns pass/fail per line (never the key's amounts). */
export async function runCheck(repo: LabRepo, ctx: LabContext, scenarioId: string, ret: unknown, intake: unknown) {
  const { ms } = await requireStudentAccess(repo, ctx, scenarioId);
  const key = await repo.getKey(scenarioId);
  if (!key || !key.checks.length) throw new ValidationError("This scenario has no answer key yet.");
  const prior = await repo.getWork(ms.member.id, scenarioId);
  await repo.saveWork({ member_id: ms.member.id, scenario_id: scenarioId, ret: normalizeReturn(ret) as unknown as Record<string, unknown>, intake: sanitizeIntake(intake), checks_run: (prior?.checks_run ?? 0) + 1 });
  return { ...checkAgainstKey(key, ret), rejects: rejectCount(ret) };
}

/** Whether this member has an instructor who reviews work (students of an instructor license do; individual students don't). */
export function hasReviewer(ms: Membership | null): boolean {
  return Boolean(ms && ms.member.role === "student" && ms.terms.kind === "instructor");
}

export async function submitWork(repo: LabRepo, ctx: LabContext, scenarioId: string, ret: unknown, intake: unknown, note: string, now: Date): Promise<LabWork> {
  const { ms } = await requireStudentAccess(repo, ctx, scenarioId);
  if (!hasReviewer(ms)) throw new ValidationError("Your license doesn't include instructor review. Use Check my return to see your results.");
  const key = await repo.getKey(scenarioId);
  if (!key || !key.checks.length) throw new ValidationError("This scenario has no answer key yet.");
  const clean_ = normalizeReturn(ret) as unknown as Record<string, unknown>;
  const result = checkAgainstKey(key, clean_);
  return repo.saveWork({
    member_id: ms.member.id, scenario_id: scenarioId, ret: clean_, intake: sanitizeIntake(intake),
    status: "submitted", submitted_ret: clean_, submitted_intake: sanitizeIntake(intake), note: clean(note, 2000) || null,
    correct: result.correct, total: result.total, efile_rejects: rejectCount(clean_), submitted_at: now.toISOString(),
    grade: null, score: null, feedback: null, graded_by: null, graded_at: null,
  });
}

/** The submissions an instructor reviews: work of the students on their license, newest first, ungraded first. */
export async function reviewQueue(repo: LabRepo, ms: Membership): Promise<{ work: LabWork; student: LabMember }[]> {
  if (ms.member.role !== "instructor") return [];
  const students = (await repo.membersOfLicense(ms.member.license_id)).filter((m) => m.role === "student");
  const byId = new Map(students.map((m) => [m.id, m]));
  const work = (await repo.workForMembers(students.map((s) => s.id))).filter((w) => w.status !== "draft");
  return work
    .map((w) => ({ work: w, student: byId.get(w.member_id)! }))
    .sort((a, b) => Number(a.work.status === "graded") - Number(b.work.status === "graded") || String(b.work.submitted_at).localeCompare(String(a.work.submitted_at)));
}

export async function reviewableWork(repo: LabRepo, ms: Membership, workId: string): Promise<{ work: LabWork; student: LabMember }> {
  const work = await repo.getWorkById(workId);
  const student = work ? await repo.getMember(work.member_id) : null;
  if (ms.member.role !== "instructor" || !work || !student || student.license_id !== ms.member.license_id || work.status === "draft") throw new ValidationError("Submission not found.");
  return { work, student };
}

export async function gradeWork(repo: LabRepo, ctx: LabContext, workId: string, input: { grade: string; score: string; feedback: string }, now: Date): Promise<LabWork> {
  if (!ctx.membership) throw new ValidationError("Submission not found.");
  const { work } = await reviewableWork(repo, ctx.membership, workId);
  return repo.saveWork({
    member_id: work.member_id, scenario_id: work.scenario_id, status: "graded",
    grade: input.grade === "revise" ? "revise" : "pass", score: clean(input.score, 20) || null, feedback: clean(input.feedback, 4000) || null,
    graded_by: ctx.userId, graded_at: now.toISOString(),
  });
}
