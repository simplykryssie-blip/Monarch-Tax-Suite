import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// Only the owner's own account may use the admin workspace. The list of administrators (public.admin_users) is the one
// place that decides it, and nothing in the app may add to it: a workspace owner, preparer or client can never become an
// administrator through a screen, an action or a signup step. Phase 7's workspace staff are tenant members, never in it.

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".next", ".git"].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) out.push(p);
  }
  return out;
};
const code = [...walk("app"), ...walk("lib"), ...walk("components"), ...walk("scripts")].filter((f) => !f.includes("database.types"));
const read = (f: string) => readFileSync(f, "utf8");

test("only the administrator check reads the administrator list, and it only reads", () => {
  const users = code.filter((f) => /admin_users/.test(read(f)));
  // lib/admin.ts reads it; the others only mention it in a comment.
  assert.deepEqual(users.sort(), ["lib/admin.ts", "lib/commerce/authz.ts", "lib/supabase/service.ts"].sort(), "a new file touches admin_users: check it cannot add an administrator");
  for (const f of users) {
    for (const line of read(f).split("\n")) {
      if (!/admin_users/.test(line)) continue;
      const isComment = /^\s*(\/\/|\*|\/\*)/.test(line);
      if (!isComment) assert.match(line, /\.from\("admin_users"\)\.select\(/, `${f}: admin_users is used for something other than a read: ${line.trim()}`);
    }
  }
});

test("no code writes to the administrator list, by any route", () => {
  const writers = /admin_users[\s\S]{0,80}\.(insert|upsert|update|delete)\(|\.(insert|upsert|update|delete)\([^)]*admin_users|(insert\s+into|delete\s+from|update)\s+(public\.)?admin_users/i;
  for (const f of code) assert.doesNotMatch(read(f), writers, `${f} writes to admin_users`);
  // The lookup is the only use of its logged access reason.
  const holders = code.filter((f) => /platformClient\("admin_lookup"\)/.test(read(f)));
  assert.deepEqual(holders, ["lib/admin.ts"]);
});

test("the database only ever seeds the owner's own account as administrator", () => {
  const dir = "supabase/migrations";
  const seeds: string[] = [];
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".sql"))) {
    const sql = readFileSync(join(dir, name), "utf8");
    for (const m of sql.matchAll(/(insert\s+into|delete\s+from|update)\s+(public\.)?admin_users[\s\S]*?;/gi)) seeds.push(`${name}: ${m[0]}`);
  }
  assert.equal(seeds.length, 1, `only one migration may touch the list:\n${seeds.join("\n")}`);
  assert.match(seeds[0], /^20261009044133_monarch_commerce_licensing\.sql: insert into public\.admin_users/i);
  assert.match(seeds[0], /lower\(email\) = 'info@monarchtaxsuite\.com'/);
});

test("the admin workspace and everything under /admin check for an administrator before showing anything", () => {
  assert.match(read("app/(admin)/layout.tsx"), /await requireAdmin\(\)/);
  assert.match(read("app/(admin)/admin/layout.tsx"), /await requirePlatformAdmin\(\)/);
  // Anyone else who signs in is sent to their own area, never into the admin workspace.
  const guard = read("lib/admin.ts");
  for (const area of ['redirect("/office")', 'redirect("/practice")', 'redirect("/portal")']) assert.ok(guard.includes(area), `${area} is missing`);
});
