import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("the booking index is public: a visitor to a booking address is not sent to the admin sign-in", () => {
  const proxy = readFileSync("lib/supabase/proxy.ts", "utf8");
  assert.match(proxy, /PUBLIC_EXACT: string\[\] = \["\/book"\]/);
  assert.match(proxy, /PUBLIC_EXACT\.includes\(request\.nextUrl\.pathname\)/);
  assert.match(proxy, /"\/book\/"/, "the booking sub-pages stay public");
});
