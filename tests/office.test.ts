import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, test } from "node:test";
import { can, cleanPermissions, defaultPermissions, DELEGABLE, featuresFor } from "../lib/office/permissions.ts";
import { acceptInvite, cancelInvite, checkInvite, cleanToken, hashToken, invite, inviteFor, setPermissions, setSuspended, type OfficeEvent, type OfficeMember, type OfficeRepo } from "../lib/office/service.ts";

const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b2";
const ADMIN = "00000000-0000-4000-8000-00000000ad01";

class MemoryOfficeRepo implements OfficeRepo {
  members: OfficeMember[] = [];
  events: OfficeEvent[] = [];
  archived = new Set<string>();
  async listOffices() { return [{ id: A, name: "Alpha Tax", archived: this.archived.has(A) }, { id: B, name: "Bravo Tax", archived: false }]; }
  async listMembers(officeId?: string) { return this.members.filter((m) => !officeId || m.organization_id === officeId).map((m) => ({ ...m })); }
  async getMember(id: string) { const m = this.members.find((x) => x.id === id); return m ? { ...m } : null; }
  async insertMember(i: Parameters<OfficeRepo["insertMember"]>[0]) {
    const m: OfficeMember = { id: randomUUID(), created_at: new Date().toISOString(), user_id: null, accepted_at: null, last_seen_at: null, status: "invited", ...i };
    this.members.push(m); return { ...m };
  }
  async updateMember(id: string, patch: Partial<OfficeMember>) { const m = this.members.find((x) => x.id === id)!; Object.assign(m, patch); return { ...m }; }
  async addEvent(e: Omit<OfficeEvent, "id" | "created_at">) { this.events.push({ id: randomUUID(), created_at: new Date().toISOString(), ...e }); }
  async listEvents(officeId: string) { return this.events.filter((e) => e.organization_id === officeId); }
}

const bureau = { userId: ADMIN, bureau: true };
const setup = () => { const repo = new MemoryOfficeRepo(); return { repo, deps: { repo } }; };

describe("permissions", () => {
  test("each role inherits the one below it", () => {
    for (const k of ["clients.intake", "returns.prep", "returns.assigned"]) {
      assert.equal(can("preparer", defaultPermissions(), k), true, k);
      assert.equal(can("ero", {}, k), true, k);
      assert.equal(can("bureau", {}, k), true, k);
    }
    for (const k of ["fees.view", "efile.manage", "team.manage", "office.dashboard"]) {
      assert.equal(can("preparer", defaultPermissions(), k), false, k);
      assert.equal(can("ero", {}, k), true, k);
    }
    assert.equal(can("ero", {}, "eros.manage"), false);
    assert.equal(can("bureau", {}, "eros.manage"), true);
    assert.equal(can("bureau", {}, "offices.all"), true);
  });

  test("the ERO decides for each preparer, but can't hand over team management", () => {
    assert.equal(can("preparer", { "returns.prep": false }, "returns.prep"), false);
    assert.equal(can("preparer", { "fees.view": true }, "fees.view"), true);
    assert.equal(can("preparer", { "team.manage": true }, "team.manage"), false);
    assert.equal(can("preparer", { "eros.manage": true }, "eros.manage"), false);
    assert.ok(!DELEGABLE.some((f) => f.key === "team.manage" || f.level === "bureau"));
    assert.deepEqual(cleanPermissions({ "fees.view": "on", "team.manage": true, "nonsense": true, "returns.prep": false }), { "returns.prep": false, "fees.view": true });
    assert.equal(featuresFor("preparer", defaultPermissions()).some((f) => f.key === "fees.view"), false);
  });
});

describe("office team", () => {
  test("the bureau invites an ERO; the link works once, for the invited email", async () => {
    const { deps, repo } = setup();
    const { member, token } = await invite(deps, bureau, { officeId: A, role: "ero", email: "Ero@Example.com ", fullName: "Erin Ero" });
    assert.equal(member.email, "ero@example.com");
    assert.equal(member.invite_token_hash, hashToken(token));
    assert.ok(!JSON.stringify(repo.members).includes(token), "only the hash is stored");
    const lookup = async (h: string) => repo.members.find((m) => m.invite_token_hash === h) ?? null;
    const found = await inviteFor(token, lookup);
    assert.equal(found?.id, member.id);
    await assert.rejects(() => acceptInvite(deps, found!, "user-1", "someone@else.com"), /This invite is for ero@example.com/);
    const done = await acceptInvite(deps, found!, "user-1", "ero@example.com");
    assert.equal(done.status, "active");
    assert.equal(await inviteFor(token, lookup), null, "used once");
    assert.equal(await inviteFor(token.slice(0, 10), lookup), null);
  });

  test("invites expire", async () => {
    const { repo } = setup();
    const { token } = await invite({ repo, now: () => new Date("2026-01-01T00:00:00Z") }, bureau, { officeId: A, role: "ero", email: "e@example.com", fullName: "Erin" });
    const lookup = async (h: string) => repo.members.find((m) => m.invite_token_hash === h) ?? null;
    assert.ok(await inviteFor(token, lookup, new Date("2026-01-07T00:00:00Z")));
    assert.equal(await inviteFor(token, lookup, new Date("2026-01-09T00:00:00Z")), null);
  });

  test("an ERO manages only their own office's preparers, never EROs", async () => {
    const { deps } = setup();
    const { member: ero } = await invite(deps, bureau, { officeId: A, role: "ero", email: "e@example.com", fullName: "Erin" });
    const active = await acceptInvite(deps, ero, "user-e", "e@example.com");
    const asEro = { userId: "user-e", bureau: false, member: active };
    const { member: prep } = await invite(deps, asEro, { officeId: A, role: "preparer", email: "p@example.com", fullName: "Pat" });
    assert.deepEqual(prep.permissions, defaultPermissions());
    await assert.rejects(() => invite(deps, asEro, { officeId: B, role: "preparer", email: "x@example.com", fullName: "Xan" }), /Only this office's ERO/);
    await assert.rejects(() => invite(deps, asEro, { officeId: A, role: "ero", email: "x@example.com", fullName: "Xan" }), /Only the bureau/);
    await setPermissions(deps, asEro, prep.id, { "fees.view": "on", "returns.prep": false });
    assert.deepEqual((await deps.repo.getMember(prep.id))!.permissions, { "returns.prep": false, "fees.view": true });
    await assert.rejects(() => setSuspended(deps, asEro, active.id, true), /Only the bureau/);
    await cancelInvite(deps, asEro, prep.id);
    assert.equal((await deps.repo.getMember(prep.id))!.status, "suspended");
    // A withdrawn invite can be sent again; a suspended member who joined can't be "invited" again.
    assert.equal((await invite(deps, asEro, { officeId: A, role: "preparer", email: "p@example.com", fullName: "Pat" })).member.status, "invited");
  });

  test("a preparer can't manage the team, and everything is in the history", async () => {
    const { deps, repo } = setup();
    const { member: p } = await invite(deps, bureau, { officeId: A, role: "preparer", email: "p@example.com", fullName: "Pat" });
    const prep = await acceptInvite(deps, p, "user-p", "p@example.com");
    await assert.rejects(() => invite(deps, { userId: "user-p", bureau: false, member: prep }, { officeId: A, role: "preparer", email: "q@example.com", fullName: "Quinn" }), /Only this office's ERO/);
    await setSuspended(deps, bureau, prep.id, true);
    await setSuspended(deps, bureau, prep.id, false);
    assert.equal((await deps.repo.getMember(prep.id))!.status, "active");
    assert.deepEqual(repo.events.map((e) => e.action), ["invited", "invite_accepted", "suspended", "reactivated"]);
  });
});

describe("invite links", () => {
  test("a link survives what pasting does to it: encoding, spaces, trailing punctuation, a query string", async () => {
    const { deps, repo } = setup();
    const { member, token } = await invite(deps, bureau, { officeId: A, role: "ero", email: "e@example.com", fullName: "Erin" });
    const lookup = async (h: string) => repo.members.find((m) => m.invite_token_hash === h) ?? null;
    for (const messy of [token, ` ${token} `, `${token}.`, `${token},`, `(${token})`, `${token}?utm=1`, `${token}#x`, `${token}/`, encodeURIComponent(token), `${token}\n`]) {
      assert.equal((await inviteFor(messy, lookup))?.id, member.id, JSON.stringify(messy));
    }
    assert.equal(cleanToken("short"), null);
    assert.equal(cleanToken(`${token}${token}`), null, "two tokens run together are not one");
    assert.equal((await checkInvite("", lookup)).reason, "malformed");
    assert.equal((await checkInvite(`${"a".repeat(43)}`, lookup)).reason, "not_found");
  });

  test("the reason is told apart: expired, and not found after it was used, withdrawn or replaced", async () => {
    const { repo } = setup();
    const deps = { repo, now: () => new Date("2026-01-01T00:00:00Z") };
    const { member, token } = await invite(deps, bureau, { officeId: A, role: "ero", email: "e@example.com", fullName: "Erin" });
    const lookup = async (h: string) => repo.members.find((m) => m.invite_token_hash === h) ?? null;
    assert.equal((await checkInvite(token, lookup, new Date("2026-01-09T00:00:00Z"))).reason, "expired");
    const again = await invite(deps, bureau, { officeId: A, role: "ero", email: "e@example.com", fullName: "Erin" });
    assert.equal((await checkInvite(token, lookup, new Date("2026-01-02T00:00:00Z"))).reason, "not_found", "a newer invite replaces the old link");
    assert.equal((await checkInvite(again.token, lookup, new Date("2026-01-02T00:00:00Z"))).reason, "ok");
    await cancelInvite(deps, bureau, member.id);
    assert.equal((await checkInvite(again.token, lookup, new Date("2026-01-02T00:00:00Z"))).reason, "not_found");
  });

  test("a withdrawn invite can be sent again with a fresh working link; it can't be 'reactivated' into a dead invite", async () => {
    const { deps, repo } = setup();
    const { member } = await invite(deps, bureau, { officeId: A, role: "ero", email: "e@example.com", fullName: "Erin" });
    await cancelInvite(deps, bureau, member.id);
    await assert.rejects(setSuspended(deps, bureau, member.id, false), /link no longer works/);
    assert.equal((await deps.repo.getMember(member.id))!.status, "suspended");
    const again = await invite(deps, bureau, { officeId: A, role: "ero", email: "E@example.com", fullName: "Erin Ero" });
    assert.equal(again.member.id, member.id, "same person, same row");
    assert.equal(again.member.status, "invited");
    const lookup = async (h: string) => repo.members.find((m) => m.invite_token_hash === h) ?? null;
    assert.equal((await inviteFor(again.token, lookup))?.id, member.id);
    // Someone who has joined can't be invited again, and reactivating a real member still works.
    const done = await acceptInvite(deps, (await inviteFor(again.token, lookup))!, "user-1", "e@example.com");
    await assert.rejects(invite(deps, bureau, { officeId: A, role: "ero", email: "e@example.com", fullName: "Erin" }), /already on this office's team/);
    await setSuspended(deps, bureau, done.id, true);
    await setSuspended(deps, bureau, done.id, false);
    assert.equal((await deps.repo.getMember(done.id))!.status, "active");
  });
});
