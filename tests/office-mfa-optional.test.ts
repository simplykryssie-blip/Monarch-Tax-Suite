import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Two-step sign-in in the office area is recommended and the person's choice: a code is asked for only once they have turned it on.
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("office two-step sign-in is optional", () => {
  test("the office gate sends someone to the code screen only when they have two-step on", () => {
    const server = read("lib/office/server.ts");
    assert.match(server, /if \(mfa\.hasFactor && mfa\.level !== "aal2"\) redirect\("\/office\/mfa"\)/);
    assert.doesNotMatch(server, /if \(mfa\.level !== "aal2"\) redirect/);
  });

  test("the setup screen has a skip for someone without two-step, and none for someone who has it", () => {
    const page = read("app/office/mfa/page.tsx");
    assert.match(page, /\.\.\.\(hasFactor \? \{\} : \{ skip: skipMfaAction \}\)/);
    assert.match(read("app/office/actions.ts"), /export async function skipMfaAction/);
  });

  test("nothing in the office area tells people two-step is required", () => {
    for (const f of ["app/office/mfa/page.tsx", "components/office/mfa-setup.tsx", "lib/office/service.ts", "app/(admin)/offices/page.tsx"]) {
      assert.doesNotMatch(read(f), /(must turn on two-step|needs it, as the FTC|Required before the office area|It's required for every account)/, f);
    }
  });
});
