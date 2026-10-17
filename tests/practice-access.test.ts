import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { hashToken } from "../lib/office/service.ts";
import {
  acceptInvite, checkInvite, provisionWorkspace, reissueInvite, setSuspended, slugFor, withdrawInvite,
  type AuditInput, type PracticeMember, type PracticePlatform, type PracticeRepo,
} from "../lib/practice/service.ts";

// Independent PTIN holder sign-in: the platform administrator creates the workspace and invites the owner; accepting
// links the account; withdrawing, resending and suspending work; every step is audited. Fake data only.

class FakeRepo implements PracticeRepo {
  members: PracticeMember[] = [];
  audit: AuditInput[] = [];
  async listMembers() { return this.members; }
  async getMember(id: string) { return this.members.find((m) => m.id === id) ?? null; }
  async insertMember(i: Parameters<PracticeRepo["insertMember"]>[0]) {
    const m: PracticeMember = { id: `m${this.members.length + 1}`, role: "owner", user_id: null, status: "invited", accepted_at: null, last_seen_at: null, created_at: "2026-10-17T00:00:00Z", ...i };
    this.members.push(m);
    return m;
  }
  async updateMember(id: string, patch: Partial<PracticeMember>) {
    const m = this.members.find((x) => x.id === id)!;
    Object.assign(m, patch);
    return m;
  }
  async addAudit(i: AuditInput) { this.audit.push(i); }
}
class FakePlatform implements PracticePlatform {
  tenants: { id: string; slug: string; name: string; tier: string }[] = [];
  members: { tenantId: string; userId: string; role: string }[] = [];
  async createTenant(i: { slug: string; name: string; tier: "ptin" }) { const t = { id: `t${this.tenants.length + 1}`, ...i }; this.tenants.push(t); return { id: t.id }; }
  async addTenantMember(tenantId: string, userId: string, role: "owner") { this.members.push({ tenantId, userId, role }); }
}
const NOW = new Date("2026-10-17T12:00:00Z");
const setup = () => {
  const platform = new FakePlatform();
  const repos = new Map<string, FakeRepo>();
  const repoFor = (t: string) => { if (!repos.has(t)) repos.set(t, new FakeRepo()); return repos.get(t)!; };
  return { platform, repoFor };
};

describe("creating an independent PTIN workspace", () => {
  test("makes a ptin-tier tenant and invites the owner with a one-time link", async () => {
    const { platform, repoFor } = setup();
    const r = await provisionWorkspace(platform, repoFor, "admin1", { workspaceName: "  Pat's Tax  ", email: " Pat@Example.com ", fullName: "Pat Example" }, { now: () => NOW, slug: () => "abc123" });
    assert.equal(platform.tenants[0].tier, "ptin");
    assert.equal(platform.tenants[0].name, "Pat's Tax");
    assert.equal(platform.tenants[0].slug, "ptin-pat-s-tax-abc123");
    const m = repoFor(r.tenantId).members[0];
    assert.equal(m.email, "pat@example.com");
    assert.equal(m.status, "invited");
    assert.equal(m.invite_token_hash, hashToken(r.token));
    assert.equal(m.invite_expires_at, "2026-10-24T12:00:00.000Z");
    assert.deepEqual(repoFor(r.tenantId).audit.map((a) => a.action), ["workspace_created"]);
  });
  test("refuses a bad email or name, and creates nothing", async () => {
    const { platform, repoFor } = setup();
    await assert.rejects(provisionWorkspace(platform, repoFor, "a", { workspaceName: "", email: "nope", fullName: "Pat" }), /valid email/);
    await assert.rejects(provisionWorkspace(platform, repoFor, "a", { workspaceName: "", email: "p@example.com", fullName: "P" }), /name/);
    assert.equal(platform.tenants.length, 0);
  });
  test("the workspace name defaults to the holder's name; slugs are url-safe", () => {
    assert.match(slugFor("Ünï Çode & Co.", () => "ffffff"), /^ptin-[a-z0-9-]+-ffffff$/);
    assert.equal(slugFor("!!!", () => "000000"), "ptin-workspace-000000");
  });
});

describe("accepting, withdrawing, resending, suspending", () => {
  const make = async () => {
    const s = setup();
    const r = await provisionWorkspace(s.platform, s.repoFor, "admin1", { workspaceName: "Pat Workspace", email: "pat@example.com", fullName: "Pat" }, { now: () => NOW });
    return { ...s, ...r, repo: s.repoFor(r.tenantId) };
  };
  test("a valid link finds the invite; a used, expired or garbled one does not", async () => {
    const t = await make();
    const lookup = async (h: string) => t.repo.members.find((m) => m.invite_token_hash === h) ?? null;
    assert.equal((await checkInvite(t.token, lookup, NOW)).reason, "ok");
    assert.equal((await checkInvite("short", lookup, NOW)).reason, "malformed");
    assert.equal((await checkInvite(t.token, lookup, new Date("2026-11-01T00:00:00Z"))).reason, "expired");
    await acceptInvite({ repo: t.repo, now: () => NOW }, t.platform, t.tenantId, t.member, "u1", "pat@example.com");
    assert.equal((await checkInvite(t.token, lookup, NOW)).reason, "not_found");
  });
  test("accepting links the account to the workspace, only for the invited email", async () => {
    const t = await make();
    await assert.rejects(acceptInvite({ repo: t.repo }, t.platform, t.tenantId, t.member, "u9", "other@example.com"), /invite is for pat@example.com/);
    assert.equal(t.platform.members.length, 0);
    const done = await acceptInvite({ repo: t.repo, now: () => NOW }, t.platform, t.tenantId, t.member, "u1", "PAT@example.com");
    assert.equal(done.status, "active");
    assert.equal(done.user_id, "u1");
    assert.equal(done.invite_token_hash, null);
    assert.deepEqual(t.platform.members, [{ tenantId: t.tenantId, userId: "u1", role: "owner" }]);
    assert.ok(t.repo.audit.some((a) => a.action === "invite_accepted"));
  });
  test("withdraw kills the link; a new link replaces an old one; an accepted account can't be re-invited", async () => {
    const t = await make();
    await withdrawInvite({ repo: t.repo }, "admin1", t.member.id);
    assert.equal(t.repo.members[0].invite_token_hash, null);
    await assert.rejects(setSuspended({ repo: t.repo }, "admin1", t.member.id, false), /withdrawn/);
    const again = await reissueInvite({ repo: t.repo, now: () => NOW }, "admin1", t.member.id);
    assert.equal(t.repo.members[0].status, "invited");
    assert.notEqual(again.token, t.token);
    await acceptInvite({ repo: t.repo, now: () => NOW }, t.platform, t.tenantId, t.repo.members[0], "u1", "pat@example.com");
    await assert.rejects(reissueInvite({ repo: t.repo }, "admin1", t.member.id), /already accepted/);
    await assert.rejects(withdrawInvite({ repo: t.repo }, "admin1", t.member.id), /Suspend/);
  });
  test("suspending and reactivating an accepted account is audited", async () => {
    const t = await make();
    await acceptInvite({ repo: t.repo, now: () => NOW }, t.platform, t.tenantId, t.member, "u1", "pat@example.com");
    await setSuspended({ repo: t.repo }, "admin1", t.member.id, true);
    assert.equal(t.repo.members[0].status, "suspended");
    await setSuspended({ repo: t.repo }, "admin1", t.member.id, false);
    assert.equal(t.repo.members[0].status, "active");
    assert.deepEqual(t.repo.audit.map((a) => a.action).slice(-2), ["suspended", "reactivated"]);
  });
});
