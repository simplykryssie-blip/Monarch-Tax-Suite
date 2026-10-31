import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerAddress, releaseAddress } from "../lib/sites/address.ts";
import type { DomainsPort } from "../lib/sites/service.ts";

const port = (state: { has: Set<string>; added: string[]; removed: string[]; failAdd?: boolean }): DomainsPort => ({
  add: async (h) => { if (state.failAdd) throw new Error("boom"); state.added.push(h); state.has.add(h); return { verified: true, verification: [] }; },
  check: async (h) => (state.has.has(h) ? { verified: true, verification: [], misconfigured: false } : null),
  remove: async (h) => { state.removed.push(h); state.has.delete(h); },
});
const fresh = () => ({ has: new Set<string>(), added: [] as string[], removed: [] as string[] });

test("a new address is put on the hosting project once; repeating it changes nothing", async () => {
  const s = fresh();
  assert.equal(await registerAddress(port(s), "a.sites.verexahq.com", true), "added");
  assert.equal(await registerAddress(port(s), "a.sites.verexahq.com", true), "already");
  assert.deepEqual(s.added, ["a.sites.verexahq.com"]);
});

test("a test deployment, a missing host setting or a missing address never touches the hosting project", async () => {
  const s = fresh();
  assert.equal(await registerAddress(port(s), "a.sites.verexahq.com", false), "off");
  assert.equal(await registerAddress(null, "a.sites.verexahq.com", true), "off");
  assert.equal(await registerAddress(port(s), null, true), "off");
  assert.deepEqual(s.added, []);
});

test("a hosting problem is reported, not thrown, so it never blocks what the person was doing", async () => {
  const s = { ...fresh(), failAdd: true };
  assert.equal(await registerAddress(port(s), "a.sites.verexahq.com", true), "failed");
});

test("a renamed address is released, and only when live", async () => {
  const s = fresh(); s.has.add("old.sites.verexahq.com");
  await releaseAddress(port(s), "old.sites.verexahq.com", false);
  assert.deepEqual(s.removed, []);
  await releaseAddress(port(s), "old.sites.verexahq.com", true);
  assert.deepEqual(s.removed, ["old.sites.verexahq.com"]);
});

test("addresses are registered where they are made: new website, renamed website, new signed-up workspace; live deployment only", () => {
  const svc = readFileSync("lib/sites/service.ts", "utf8");
  assert.match(svc, /registerAddress\(deps\.domains, address, deps\.registerAddresses === true\)/);
  assert.match(svc, /releaseAddress\(deps\.domains, sub\.hostname/);
  assert.match(readFileSync("lib/sites/server.ts", "utf8"), /registerAddresses: process\.env\.VERCEL_ENV === "production"/);
  assert.match(readFileSync("lib/billing/service.ts", "utf8"), /deps\.provision\.registerAddress\?\.\(defaultHostFor\(usedSlug/);
  assert.match(readFileSync("lib/billing/server.ts", "utf8"), /registerAddress: \(host\) => registerAddress\(vercelDomains\(\), host, process\.env\.VERCEL_ENV === "production"\)/);
});
