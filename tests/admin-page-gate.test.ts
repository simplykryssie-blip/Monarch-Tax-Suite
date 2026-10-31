import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// A workspace page and its layout render side by side, so a page that reads tenant data must prove the workspace itself first
// (requireAdmin). Otherwise it can read before the layout has resolved the workspace and see Monarch's data (the PTIN client 404).

const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const READS = /currentTenantId|Deps\(|Repo\(|tenantDb\(|tenantClient\(|loadBrand|listStaff|workspaceLoad|workspaceRepo|Store\(/;
const GATE = /requireAdmin|requireSection|requirePlatformAdmin/;

test("every workspace page that reads tenant data proves the workspace first", () => {
  const bare = walk("app/(admin)").filter((f) => f.endsWith("/page.tsx")).filter((f) => { const s = readFileSync(f, "utf8"); return READS.test(s) && !GATE.test(s); });
  assert.deepEqual(bare, []);
});
