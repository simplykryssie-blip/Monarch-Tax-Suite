import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ValidationError } from "../lib/commerce/validation.ts";
import { hashToken } from "../lib/office/service.ts";
import { portalMessageVisible } from "../lib/portal/visibility.ts";
import { acceptPortalInvite, checkPortalInvite, inviteClient, portalInviteEmail, setPortalAccess, withdrawPortalInvite, type PortalAudit, type PortalMember, type PortalMemberRepo } from "../lib/portal/service.ts";

class Memory implements PortalMemberRepo {
  rows: PortalMember[] = [];
  audit: PortalAudit[] = [];
  async getForClient(clientId: string) { return this.rows.find((r) => r.client_id === clientId) ?? null; }
  async get(id: string) { return this.rows.find((r) => r.id === id) ?? null; }
  async insert(input: Parameters<PortalMemberRepo["insert"]>[0]) {
    const row: PortalMember = { id: `m${this.rows.length + 1}`, tenant_id: "t1", user_id: null, status: "invited", accepted_at: null, last_seen_at: null, created_at: new Date().toISOString(), ...input };
    this.rows.push(row);
    return row;
  }
  async update(id: string, patch: Parameters<PortalMemberRepo["update"]>[1]) {
    const row = this.rows.find((r) => r.id === id)!;
    Object.assign(row, patch);
    return row;
  }
  async addAudit(a: PortalAudit) { this.audit.push(a); }
}
const client = { id: "c1", full_name: "Test Client", email: "Client@Example.com", archived_at: null };
const NOW = new Date("2027-01-10T12:00:00Z");

describe("portal invites", () => {
  test("invites by the client's email, stores only the token hash, and audits", async () => {
    const repo = new Memory();
    const { member, token, resent } = await inviteClient({ repo, now: () => NOW }, "staff1", client);
    assert.equal(resent, false);
    assert.equal(member.email, "client@example.com");
    assert.equal(member.invite_token_hash, hashToken(token));
    assert.ok(!JSON.stringify(member).includes(token));
    assert.equal(Date.parse(member.invite_expires_at!), NOW.getTime() + 7 * 86_400_000);
    assert.equal(repo.audit[0].action, "portal_invited");
  });

  test("needs an email and a client that isn't archived", async () => {
    const repo = new Memory();
    await assert.rejects(inviteClient({ repo }, null, { ...client, email: null }), ValidationError);
    await assert.rejects(inviteClient({ repo }, null, { ...client, email: "nope" }), ValidationError);
    await assert.rejects(inviteClient({ repo }, null, { ...client, archived_at: "2027-01-01" }), /archived/);
  });

  test("a second invite replaces the link; the old link stops working", async () => {
    const repo = new Memory();
    const first = await inviteClient({ repo, now: () => NOW }, null, client);
    const second = await inviteClient({ repo, now: () => NOW }, null, client);
    assert.equal(second.resent, true);
    assert.equal(repo.rows.length, 1);
    const lookup = async (h: string) => repo.rows.find((r) => r.invite_token_hash === h) ?? null;
    assert.equal((await checkPortalInvite(first.token, lookup, NOW)).reason, "not_found");
    assert.equal((await checkPortalInvite(second.token, lookup, NOW)).reason, "ok");
  });

  test("an expired or malformed link says so", async () => {
    const repo = new Memory();
    const { token } = await inviteClient({ repo, now: () => NOW }, null, client);
    const lookup = async (h: string) => repo.rows.find((r) => r.invite_token_hash === h) ?? null;
    assert.equal((await checkPortalInvite(token, lookup, new Date(NOW.getTime() + 8 * 86_400_000))).reason, "expired");
    assert.equal((await checkPortalInvite("short", lookup, NOW)).reason, "malformed");
  });

  test("accepting needs the invited email, activates, and ends the link", async () => {
    const repo = new Memory();
    const { member, token } = await inviteClient({ repo, now: () => NOW }, null, client);
    await assert.rejects(acceptPortalInvite({ repo, now: () => NOW }, member, "u1", "someone@else.com"), /invite is for client@example.com/);
    const done = await acceptPortalInvite({ repo, now: () => NOW }, member, "u1", "CLIENT@example.com");
    assert.equal(done.status, "active");
    assert.equal(done.user_id, "u1");
    assert.equal(done.invite_token_hash, null);
    const lookup = async (h: string) => repo.rows.find((r) => r.invite_token_hash === h) ?? null;
    assert.equal((await checkPortalInvite(token, lookup, NOW)).reason, "not_found");
    await assert.rejects(inviteClient({ repo }, null, client), /already has a portal login/);
  });

  test("withdraw only before acceptance; access can be turned off and on after", async () => {
    const repo = new Memory();
    const { member } = await inviteClient({ repo }, null, client);
    await assert.rejects(setPortalAccess({ repo }, null, "c1", true), /haven't accepted/);
    await withdrawPortalInvite({ repo }, null, "c1");
    assert.equal(repo.rows[0].status, "suspended");
    assert.equal(repo.rows[0].invite_token_hash, null);
    const again = await inviteClient({ repo }, null, client);
    assert.equal(again.member.status, "invited");
    await acceptPortalInvite({ repo }, again.member, "u1", "client@example.com");
    await assert.rejects(withdrawPortalInvite({ repo }, null, "c1"), /Turn off their access/);
    await setPortalAccess({ repo }, null, "c1", false);
    assert.equal(repo.rows[0].status, "suspended");
    await setPortalAccess({ repo }, null, "c1", true);
    assert.equal(repo.rows[0].status, "active");
    assert.ok(member);
  });

  test("the email names the office and carries the link", () => {
    const mail = portalInviteEmail({ office: "Test Tax Office", name: "Test Client", link: "https://example.com/portal/invite/x" });
    assert.match(mail.subject, /Test Tax Office/);
    assert.match(mail.text, /https:\/\/example\.com\/portal\/invite\/x/);
  });
});

describe("what a client may read", () => {
  test("only sent emails and texts, and what the client sent; never call logs or failed sends", () => {
    assert.equal(portalMessageVisible({ channel: "email", direction: "out", status: "sent" }), true);
    assert.equal(portalMessageVisible({ channel: "sms", direction: "out", status: "sent" }), true);
    assert.equal(portalMessageVisible({ channel: "email", direction: "in", status: "logged" }), true);
    assert.equal(portalMessageVisible({ channel: "email", direction: "out", status: "logged" }), false);
    assert.equal(portalMessageVisible({ channel: "email", direction: "out", status: "failed" }), false);
    assert.equal(portalMessageVisible({ channel: "call", direction: "out", status: "sent" }), false);
    assert.equal(portalMessageVisible({ channel: "other", direction: "in", status: "logged" }), false);
  });
});
