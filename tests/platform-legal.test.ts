import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PLATFORM_LEGAL_APPROVED, PLATFORM_LEGAL_PATHS } from "../lib/platform-legal.ts";

// Verexa HQ's own policies are placeholder drafts: invisible, unlinked and not required by anything until the owner approves.
const root = new URL("../", import.meta.url).pathname;
const read = (rel: string) => readFileSync(root + rel, "utf8");
const PAGES = ["terms", "privacy", "refunds", "acceptable-use"].map((n) => `app/legal/${n}/page.tsx`);

test("the platform policies are unpublished, and Monarch's published pages are untouched", () => {
  assert.equal(PLATFORM_LEGAL_APPROVED, false);
  assert.deepEqual([...PLATFORM_LEGAL_PATHS], ["/legal/terms", "/legal/privacy", "/legal/refunds", "/legal/acceptable-use"]);
  assert.match(read("lib/platform-legal.ts"), /export const PLATFORM_LEGAL_APPROVED: boolean = false;/);
  assert.match(read("lib/legal.ts"), /export const LEGAL_PAGES_APPROVED: boolean = true;/);
});

test("each platform page returns 404 first thing while unapproved, and shows the placeholder banner", () => {
  for (const file of PAGES) {
    const src = read(file);
    assert.match(src, /export default function \w+\(\) \{\s*(?:\/\/[^\n]*\n\s*)?if \(!PLATFORM_LEGAL_APPROVED\) notFound\(\);/, file);
    assert.match(src, /<LegalPage [^>]*platform>/, file);
    assert.match(src, /\[To confirm/, `${file}: open points must stay marked`);
    assert.doesNotMatch(src, /Monarch/, `${file}: the platform's policies name Verexa HQ, not Monarch`);
  }
});

test("the proxy lists the platform paths as public only when approved", () => {
  assert.match(read("lib/supabase/proxy.ts"), /\.\.\.\(PLATFORM_LEGAL_APPROVED \? PLATFORM_LEGAL_PATHS : \[\]\)/);
});
