import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { generateLicenseKey, hashLicenseKey } from "../lib/commerce/license-keys.ts";
import {
  acceptInvite, activateKey, activeMemberships, canViewScenario, checkAgainstKey, gradeWork, inviteFor, inviteStudents, labProductBlockers,
  removeStudent, reviewQueue, runCheck, saveScenario, studentView, submitWork, visibleScenarios, type LabContext, type ScenarioForm,
} from "../lib/lab/service.ts";
import type { LabCommercePort, LabKey, LabMember, LabRepo, LabScenario, LabTerms, LabWork, NewMember, ScenarioInput } from "../lib/lab/types.ts";

class MemoryLab implements LabRepo {
  terms = new Map<string, LabTerms>();
  members: LabMember[] = [];
  scenarios = new Map<string, LabScenario>();
  keys = new Map<string, LabKey>();
  work: LabWork[] = [];
  async getTerms(id: string) { return this.terms.get(id) ?? null; }
  async createTerms(t: LabTerms) { if (this.terms.has(t.license_id)) throw new Error("duplicate"); this.terms.set(t.license_id, t); return t; }
  async membersForUser(u: string) { return this.members.filter((m) => m.user_id === u); }
  async membersOfLicense(l: string) { return this.members.filter((m) => m.license_id === l); }
  async getMember(id: string) { return this.members.find((m) => m.id === id) ?? null; }
  async memberByInviteHash(h: string) { return this.members.find((m) => m.invite_token_hash === h) ?? null; }
  async createMember(m: NewMember) {
    if (m.user_id && this.members.some((x) => x.license_id === m.license_id && x.user_id === m.user_id && x.status !== "removed")) throw new Error("unique user");
    const row = { ...m, id: randomUUID(), created_at: new Date().toISOString() };
    this.members.push(row);
    return row;
  }
  async updateMember(id: string, patch: Partial<LabMember>) { const m = this.members.find((x) => x.id === id)!; Object.assign(m, patch); return m; }
  async listScenarios(ids: string[]) { return [...this.scenarios.values()].filter((s) => s.license_id === null || ids.includes(s.license_id)); }
  async getScenario(id: string) { return this.scenarios.get(id) ?? null; }
  async saveScenario(s: ScenarioInput) { const now = new Date().toISOString(); const row = { ...s, created_at: this.scenarios.get(s.id)?.created_at ?? now, updated_at: now }; this.scenarios.set(s.id, row); return row; }
  async deleteScenario(id: string) { this.scenarios.delete(id); }
  async getKey(id: string) { return this.keys.get(id) ?? null; }
  async saveKey(k: LabKey) { this.keys.set(k.scenario_id, k); return k; }
  async getWork(m: string, s: string) { return this.work.find((w) => w.member_id === m && w.scenario_id === s) ?? null; }
  async getWorkById(id: string) { return this.work.find((w) => w.id === id) ?? null; }
  async workForMembers(ids: string[]) { return this.work.filter((w) => ids.includes(w.member_id)); }
  async saveWork(w: Partial<LabWork> & { member_id: string; scenario_id: string }) {
    const now = new Date().toISOString();
    let row = await this.getWork(w.member_id, w.scenario_id);
    if (!row) {
      row = { id: randomUUID(), ret: {}, intake: {}, checks_run: 0, status: "draft", submitted_ret: null, submitted_intake: null, note: null, correct: null, total: null, efile_rejects: null, submitted_at: null, grade: null, score: null, feedback: null, graded_by: null, graded_at: null, created_at: now, updated_at: now, member_id: w.member_id, scenario_id: w.scenario_id };
      this.work.push(row);
    }
    Object.assign(row, w, { updated_at: now });
    return row;
  }
}

const NOW = new Date("2027-01-15T12:00:00Z");
const INSTRUCTOR = "11111111-1111-4111-8111-111111111111";
const STUDENT = "22222222-2222-4222-8222-222222222222";
const ADMIN = "33333333-3333-4333-8333-333333333333";

function commerceWith(licenses: { key: string; id: string; product: string; status?: string }[], products: Record<string, Record<string, string>>): LabCommercePort {
  return {
    async findLicenseByKeyHash(h) { const l = licenses.find((x) => hashLicenseKey(x.key) === h); return l ? { id: l.id, product_id: l.product, status: l.status ?? "active" } : null; },
    async getProduct(id) { return products[id] ? { id, name: id, metadata: products[id] } : null; },
  };
}

async function setup() {
  const repo = new MemoryLab();
  const instructorKey = generateLicenseKey();
  const studentKey = generateLicenseKey();
  const calcKey = generateLicenseKey();
  const commerce = commerceWith(
    [{ key: instructorKey, id: "lic-inst", product: "p-inst" }, { key: studentKey, id: "lic-stu", product: "p-stu" }, { key: calcKey, id: "lic-calc", product: "p-calc" }],
    { "p-inst": { delivery: "tax_lab", lab_role: "instructor", lab_seats: "2" }, "p-stu": { delivery: "tax_lab", lab_role: "student" }, "p-calc": {} },
  );
  return { repo, commerce, instructorKey, studentKey, calcKey };
}
const ctxOf = (userId: string, ms: Awaited<ReturnType<typeof activeMemberships>>[number] | null, isAdmin = false): LabContext => ({ userId, email: "x@example.com", isAdmin, membership: ms });

const sampleRet = {
  fs: "single", tp: { first: "Dana", last: "Reed", ssn: "412-55-1000", age: "30" },
  w2: [{ employer: "Acme", ein: "12-3456789", who: "tp", wages: "40000", fedwh: "3000" }],
};
function form(overrides: Partial<ScenarioForm> = {}): ScenarioForm {
  return { id: null, scope: "library", status: "published", title: "Single W-2", level: "Beginner", summary: "", narrative: "Dana works at Acme.", factsText: "Marital status: Single", intakeMode: "notes", docOptions: { w2: true }, ret: sampleRet, checks: ["L11a", "L15", "L35a"], overrides: {}, ...overrides };
}

test("product settings: instructor licenses need seats", () => {
  assert.deepEqual(labProductBlockers({ delivery: "tax_lab", lab_role: "instructor", lab_seats: "25" }), []);
  assert.equal(labProductBlockers({ delivery: "tax_lab", lab_role: "instructor" }).length, 1);
  assert.equal(labProductBlockers({ delivery: "tax_lab" }).length, 1);
  assert.deepEqual(labProductBlockers({}), []);
});

test("activating a key records the terms and the first member; repeats are safe; another account is refused", async () => {
  const { repo, commerce, instructorKey } = await setup();
  const ms = await activateKey(repo, commerce, { rawKey: instructorKey.toLowerCase(), userId: INSTRUCTOR, email: "Teacher@Example.com", displayName: "Ms. T", now: NOW });
  assert.equal(ms.terms.kind, "instructor");
  assert.equal(ms.terms.seats, 2);
  assert.equal(ms.terms.expires_at, "2028-01-15T12:00:00.000Z");
  assert.equal(ms.member.email, "teacher@example.com");
  const again = await activateKey(repo, commerce, { rawKey: instructorKey, userId: INSTRUCTOR, email: "teacher@example.com", displayName: null, now: NOW });
  assert.equal(again.member.id, ms.member.id);
  await assert.rejects(activateKey(repo, commerce, { rawKey: instructorKey, userId: STUDENT, email: "s@example.com", displayName: null, now: NOW }), /already been activated/);
});

test("non-training keys and bad keys are refused", async () => {
  const { repo, commerce, calcKey } = await setup();
  await assert.rejects(activateKey(repo, commerce, { rawKey: calcKey, userId: INSTRUCTOR, email: "a@b.co", displayName: null, now: NOW }), /not a Monarch Tax Lab license/);
  await assert.rejects(activateKey(repo, commerce, { rawKey: "MTS-123", userId: INSTRUCTOR, email: "a@b.co", displayName: null, now: NOW }), /Enter your license key/);
});

test("access ends when the term ends", async () => {
  const { repo, commerce, studentKey } = await setup();
  await activateKey(repo, commerce, { rawKey: studentKey, userId: STUDENT, email: "s@example.com", displayName: null, now: NOW });
  assert.equal((await activeMemberships(repo, STUDENT, NOW)).length, 1);
  assert.equal((await activeMemberships(repo, STUDENT, new Date("2028-01-16T00:00:00Z"))).length, 0);
});

test("seats limit invites; joining uses the link once; removing frees the seat", async () => {
  const { repo, commerce, instructorKey } = await setup();
  const ms = await activateKey(repo, commerce, { rawKey: instructorKey, userId: INSTRUCTOR, email: "t@example.com", displayName: null, now: NOW });
  await assert.rejects(inviteStudents(repo, ms, "a@x.com b@x.com c@x.com", NOW), /2 open seats/);
  const invites = await inviteStudents(repo, ms, "a@x.com, b@x.com", NOW);
  assert.equal(invites.length, 2);
  await assert.rejects(inviteStudents(repo, ms, "c@x.com", NOW), /0 open seats/);
  assert.ok(await inviteFor(repo, invites[0].token, NOW));
  const joined = await acceptInvite(repo, invites[0].token, { id: STUDENT, email: "a@x.com", displayName: "Al" }, NOW);
  assert.equal(joined.status, "active");
  assert.equal(await inviteFor(repo, invites[0].token, NOW), null);
  await assert.rejects(acceptInvite(repo, invites[0].token, { id: STUDENT, email: "a@x.com", displayName: null }, NOW), /expired or was already used/);
  const b = repo.members.find((m) => m.email === "b@x.com")!;
  await removeStudent(repo, ms, b.id);
  assert.equal((await inviteStudents(repo, ms, "c@x.com", NOW)).length, 1);
  const late = new Date(NOW.getTime() + 31 * 86_400_000);
  const c = await inviteStudents(repo, ms, "d@x.com", NOW).catch(() => null);
  assert.equal(c, null); // seats full again
  assert.equal(await inviteFor(repo, invites[1].token, late), null);
});

test("library scenarios are written by administrators; class scenarios by their instructor; drafts stay hidden", async () => {
  const { repo, commerce, instructorKey, studentKey } = await setup();
  const inst = await activateKey(repo, commerce, { rawKey: instructorKey, userId: INSTRUCTOR, email: "t@example.com", displayName: null, now: NOW });
  const solo = await activateKey(repo, commerce, { rawKey: studentKey, userId: STUDENT, email: "s@example.com", displayName: null, now: NOW });
  await assert.rejects(saveScenario(repo, ctxOf(INSTRUCTOR, inst), form(), NOW), /can't edit/);
  const lib = await saveScenario(repo, ctxOf(ADMIN, null, true), form(), NOW);
  const draft = await saveScenario(repo, ctxOf(ADMIN, null, true), form({ title: "Draft", status: "draft" }), NOW);
  const cls = await saveScenario(repo, ctxOf(INSTRUCTOR, inst), form({ scope: "license", title: "Class only" }), NOW);
  assert.equal(cls.license_id, "lic-inst");
  const soloSees = (await visibleScenarios(repo, ctxOf(STUDENT, solo))).map((s) => s.title);
  assert.deepEqual(soloSees, ["Single W-2"]);
  const instSees = (await visibleScenarios(repo, ctxOf(INSTRUCTOR, inst))).map((s) => s.title).sort();
  assert.deepEqual(instSees, ["Class only", "Single W-2"]);
  assert.equal(canViewScenario(ctxOf(STUDENT, solo), draft), false);
  // The key is computed on the server from the answer return.
  const key = await repo.getKey(lib.id);
  assert.equal(key!.line_values.L11a, 40000);
  assert.deepEqual(lib.documents.w2?.[0].employer, "Acme");
});

test("interview scenarios hide the notes from students", async () => {
  const { repo } = await setup();
  const s = await saveScenario(repo, ctxOf(ADMIN, null, true), form({ intakeMode: "interview" }), NOW);
  const v = studentView(s, await repo.getKey(s.id), false);
  assert.equal(v.narrative, null);
  assert.equal(v.facts, null);
  assert.equal(v.checkCount, 3);
  assert.equal(JSON.stringify(v).includes("line_values"), false);
});

test("checking compares whole dollars on the key's lines only; overrides count", async () => {
  const { repo } = await setup();
  const s = await saveScenario(repo, ctxOf(ADMIN, null, true), form({ overrides: { L35a: "1" } }), NOW);
  const key = (await repo.getKey(s.id))!;
  const res = checkAgainstKey(key, sampleRet);
  assert.equal(res.total, 3);
  assert.equal(res.correct, 2); // the overridden refund no longer matches
  assert.deepEqual(res.results.map((r) => r.pass), [true, true, false]);
});

test("students of an instructor submit; the instructor grades; individual students only self-check", async () => {
  const { repo, commerce, instructorKey, studentKey } = await setup();
  const inst = await activateKey(repo, commerce, { rawKey: instructorKey, userId: INSTRUCTOR, email: "t@example.com", displayName: null, now: NOW });
  const [inv] = await inviteStudents(repo, inst, "kid@x.com", NOW);
  await acceptInvite(repo, inv.token, { id: STUDENT, email: "kid@x.com", displayName: null }, NOW);
  const [stuMs] = await activeMemberships(repo, STUDENT, NOW);
  const s = await saveScenario(repo, ctxOf(ADMIN, null, true), form(), NOW);
  const check = await runCheck(repo, ctxOf(STUDENT, stuMs), s.id, sampleRet, { who: "Dana" });
  assert.equal(check.correct, 3);
  const w = await submitWork(repo, ctxOf(STUDENT, stuMs), s.id, sampleRet, { who: "Dana" }, "Done", NOW);
  assert.equal(w.status, "submitted");
  assert.equal(w.checks_run, 1);
  const queue = await reviewQueue(repo, inst);
  assert.equal(queue.length, 1);
  const graded = await gradeWork(repo, ctxOf(INSTRUCTOR, inst), w.id, { grade: "revise", score: "80", feedback: "Check line 12" }, NOW);
  assert.equal(graded.grade, "revise");
  // A different instructor's license can't see or grade it.
  const solo = await activateKey(repo, commerce, { rawKey: studentKey, userId: ADMIN, email: "solo@x.com", displayName: null, now: NOW });
  await assert.rejects(submitWork(repo, ctxOf(ADMIN, solo), s.id, sampleRet, {}, "", NOW), /doesn't include instructor review/);
  await assert.rejects(gradeWork(repo, ctxOf(ADMIN, solo), w.id, { grade: "pass", score: "", feedback: "" }, NOW), /not found/);
});
