import assert from "node:assert/strict";
import test from "node:test";
import { Keyring } from "../lib/ssn/keyring.ts";
import { checkSsn, clearSsn, numberActivity, revealSsn, rewrapTenantKey, storeSsn, type KeyRow, type RevealGate, type SsnDeps, type SsnRepo } from "../lib/ssn/service.ts";

const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const C1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const C2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const key = (n: number) => Buffer.alloc(32, n);

class Memory implements SsnRepo {
  key: KeyRow | null = null;
  ct = new Map<string, string>();
  last4 = new Map<string, string | null>();
  audits: { action: string; clientId: string }[] = [];
  async clientExists(id: string) { return id === C1 || id === C2; }
  async getKey() { return this.key; }
  async insertKey(r: KeyRow) { if (this.key) return false; this.key = r; return true; }
  async listKeys() { return []; }
  async saveWrappedKey(_t: string, r: KeyRow) { this.key = r; }
  async getCiphertext(id: string) { return this.ct.get(id) ?? null; }
  async putCiphertext(id: string, c: string) { this.ct.set(id, c); }
  async deleteCiphertext(id: string) { this.ct.delete(id); }
  async setLast4(id: string, v: string | null) { this.last4.set(id, v); }
  async audit(e: { action: string; clientId: string }) { this.audits.push(e); }
  async listAudit(id: string, limit: number) { return this.audits.filter((a) => a.clientId === id).reverse().slice(0, limit).map((a, i) => ({ action: a.action, actorId: "u1", at: `2026-10-17T12:00:0${i}Z` })); }
}
const deps = (repo = new Memory(), tenantId = T1, keyring: Keyring | null = new Keyring(new Map([[1, key(1)]]))): SsnDeps => ({ tenantId, keyring, repo, now: () => new Date("2026-10-17T12:00:00Z") });
const gate = (over: Partial<RevealGate> = {}): RevealGate => ({ actorId: "u1", isMember: true, verifyPassword: async (p) => p === "right", allowAttempt: async () => true, ...over });

test("numbers are checked and normalised", () => {
  assert.equal(checkSsn("123-45-6789"), "123456789");
  assert.equal(checkSsn(" 123 45 6789 "), "123456789");
  for (const bad of ["12345678", "000-12-3456", "666-12-3456", "123-00-4567", "123-45-0000", "abcdefghi", null, 123456789]) assert.throws(() => checkSsn(bad));
});

test("stored encrypted, last four kept, never in the audit trail", async () => {
  const d = deps();
  await storeSsn(d, { clientId: C1, ssn: "123-45-6789", actorId: "u1" });
  const repo = d.repo as Memory;
  assert.match(repo.ct.get(C1)!, /^s1:/);
  assert.ok(!repo.ct.get(C1)!.includes("6789"));
  assert.equal(repo.last4.get(C1), "6789");
  assert.ok(!JSON.stringify(repo.audits).includes("123"));
  assert.deepEqual(repo.audits.map((a) => a.action), ["ssn.stored"]);
});

test("the owner reveals it with the right password, for 30 seconds, and it is audited", async () => {
  const d = deps();
  await storeSsn(d, { clientId: C1, ssn: "123456789", actorId: "u1" });
  const r = await revealSsn(d, gate(), { clientId: C1, password: "right" });
  assert.equal(r.ssn, "123-45-6789");
  assert.equal(r.seconds, 30);
  assert.equal(r.expiresAt, "2026-10-17T12:00:30.000Z");
  assert.equal((d.repo as Memory).audits.at(-1)!.action, "ssn.revealed");
});

test("anyone but the owner is refused, and it is recorded", async () => {
  const d = deps();
  await storeSsn(d, { clientId: C1, ssn: "123456789", actorId: "u1" });
  await assert.rejects(revealSsn(d, gate({ isMember: false }), { clientId: C1, password: "right" }), /work in this workspace/);
  assert.equal((d.repo as Memory).audits.at(-1)!.action, "ssn.reveal_refused");
});

test("a wrong or missing password is refused and recorded", async () => {
  const d = deps();
  await storeSsn(d, { clientId: C1, ssn: "123456789", actorId: "u1" });
  await assert.rejects(revealSsn(d, gate(), { clientId: C1, password: "nope" }), /password/);
  await assert.rejects(revealSsn(d, gate(), { clientId: C1, password: "" }), /password/);
  assert.equal((d.repo as Memory).audits.at(-1)!.action, "ssn.reveal_wrong_password");
});

test("too many attempts are refused before the password is even checked", async () => {
  const d = deps();
  await storeSsn(d, { clientId: C1, ssn: "123456789", actorId: "u1" });
  let checked = false;
  await assert.rejects(revealSsn(d, gate({ allowAttempt: async () => false, verifyPassword: async () => { checked = true; return true; } }), { clientId: C1, password: "right" }), /Too many/);
  assert.equal(checked, false);
});

test("a client with no number, or an unknown client id, gives a plain message", async () => {
  const d = deps();
  await assert.rejects(revealSsn(d, gate(), { clientId: C2, password: "right" }), /no Social Security number/);
  await assert.rejects(revealSsn(d, gate(), { clientId: "../x", password: "right" }), /wasn't found/);
});

test("a ciphertext moved to another client or tenant cannot be opened", async () => {
  const a = deps();
  await storeSsn(a, { clientId: C1, ssn: "123456789", actorId: "u1" });
  const repoA = a.repo as Memory;
  repoA.ct.set(C2, repoA.ct.get(C1)!);
  await assert.rejects(revealSsn(a, gate(), { clientId: C2, password: "right" }), /couldn't be read/);
  // The same bytes and key row under another tenant id.
  const b = deps(new Memory(), T2);
  (b.repo as Memory).key = repoA.key;
  (b.repo as Memory).ct.set(C1, repoA.ct.get(C1)!);
  await assert.rejects(revealSsn(b, gate(), { clientId: C1, password: "right" }));
});

test("each tenant gets its own data key", async () => {
  const a = deps(new Memory(), T1), b = deps(new Memory(), T2);
  await storeSsn(a, { clientId: C1, ssn: "123456789", actorId: null });
  await storeSsn(b, { clientId: C1, ssn: "123456789", actorId: null });
  assert.notEqual((a.repo as Memory).key!.wrapped_key, (b.repo as Memory).key!.wrapped_key);
});

test("rotating the master key re-wraps the data key and the number still opens", async () => {
  const repo = new Memory();
  await storeSsn(deps(repo), { clientId: C1, ssn: "987654321", actorId: null });
  assert.equal(repo.key!.master_version, 1);
  const both = new Keyring(new Map([[1, key(1)], [2, key(2)]]), 2);
  assert.equal(await rewrapTenantKey(deps(repo, T1, both)), true);
  assert.equal(repo.key!.master_version, 2);
  assert.equal(await rewrapTenantKey(deps(repo, T1, both)), false);
  // Only the new master is needed afterwards.
  const onlyNew = new Keyring(new Map([[2, key(2)]]));
  assert.equal((await revealSsn(deps(repo, T1, onlyNew), gate(), { clientId: C1, password: "right" })).ssn, "987-65-4321");
});

test("without a configured key nothing is stored", async () => {
  await assert.rejects(storeSsn(deps(new Memory(), T1, null), { clientId: C1, ssn: "123456789", actorId: null }), /isn't set up/);
});

test("clearing removes the number", async () => {
  const d = deps();
  await storeSsn(d, { clientId: C1, ssn: "123456789", actorId: null });
  await clearSsn(d, { clientId: C1, actorId: "u1" });
  assert.equal((d.repo as Memory).ct.has(C1), false);
});

test("the keyring reads versions from the environment", () => {
  const k64 = (n: number) => key(n).toString("base64");
  const r = Keyring.fromEnv({ MONARCH_ENCRYPTION_KEY: k64(1), MONARCH_ENCRYPTION_KEY_V2: k64(2) })!;
  assert.equal(r.current, 2);
  assert.ok(r.has(1) && r.has(2));
  assert.equal(Keyring.fromEnv({ MONARCH_ENCRYPTION_KEY: k64(1), MONARCH_ENCRYPTION_KEY_V2: k64(2), MONARCH_ENCRYPTION_KEY_CURRENT: "1" })!.current, 1);
  assert.equal(Keyring.fromEnv({}), null);
  assert.equal(Keyring.fromEnv({ MONARCH_ENCRYPTION_KEY: "short" }), null);
});

test("a valid ITIN is accepted like a Social Security number, and the wording says so", async () => {
  assert.equal(checkSsn("912-70-1234"), "912701234");
  assert.equal(checkSsn("999 88 4321"), "999884321");
  assert.throws(() => checkSsn("123456"), /Social Security number or ITIN/);
  assert.throws(() => checkSsn("000-12-3456"), /Social Security number or ITIN/);
});

test("the activity list shows saves and reveals, newest first, without the number", async () => {
  const d = deps();
  await storeSsn(d, { clientId: C1, ssn: "123-45-6789", actorId: "u1" });
  await revealSsn(d, gate(), { clientId: C1, password: "right" });
  await assert.rejects(revealSsn(d, gate(), { clientId: C1, password: "wrong" }));
  const a = await numberActivity(d, C1);
  assert.deepEqual(a.map((x) => x.label), ["Reveal tried with a wrong password", "Number revealed", "Number saved or replaced"]);
  assert.ok(!JSON.stringify(a).includes("6789"));
});
