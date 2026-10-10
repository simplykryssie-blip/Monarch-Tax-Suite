import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { LEGAL_PAGES_APPROVED, LEGAL_PATHS } from "../lib/legal.ts";

// The Terms, Privacy and Refund pages are unapproved drafts. Until the owner and
// counsel approve them they must be unavailable to visitors and unlinked, while the
// draft text stays in the repository so it can be reviewed and published later.

const root = new URL("../", import.meta.url).pathname;
const read = (rel: string) => readFileSync(root + rel, "utf8");
const PAGES = ["app/terms/page.tsx", "app/privacy/page.tsx", "app/refunds/page.tsx"];

test("the pages are published (owner decision, 2026-10-10), and the switch is a single reversible constant", () => {
  assert.equal(LEGAL_PAGES_APPROVED, true);
  assert.deepEqual([...LEGAL_PATHS], ["/terms", "/privacy", "/refunds"]);
  assert.match(read("lib/legal.ts"), /export const LEGAL_PAGES_APPROVED: boolean = true;/);
});

test("each draft page returns 404 (notFound) as the first thing it does while unapproved", () => {
  for (const file of PAGES) {
    const src = read(file);
    assert.match(src, /import \{ notFound \} from "next\/navigation";/, file);
    assert.match(src, /import \{ LEGAL_PAGES_APPROVED \} from "@\/lib\/legal";/, file);
    assert.match(src, /export default function \w+\(\) \{\s*(?:\/\/[^\n]*\n\s*)?if \(!LEGAL_PAGES_APPROVED\) notFound\(\);/, `${file}: guard must precede any rendering`);
  }
});

test("while published, the proxy lists exactly the three legal paths as public", () => {
  assert.match(read("lib/supabase/proxy.ts"), /\.\.\.\(LEGAL_PAGES_APPROVED \? LEGAL_PATHS : \[\]\)/);
  assert.deepEqual([...LEGAL_PATHS], ["/terms", "/privacy", "/refunds"]);
});

test("the shop links to the drafts only when they are approved", () => {
  const shop = read("app/shop/page.tsx");
  const guard = shop.indexOf("{LEGAL_PAGES_APPROVED && (");
  assert.ok(guard > -1, "links are inside the approval guard");
  for (const path of LEGAL_PATHS) {
    const at = shop.indexOf(`href="${path}"`);
    assert.ok(at > guard, `${path} link sits inside the guard`);
  }
});

test("nothing else in the app links to the drafts (alternate routes and navigation)", () => {
  const allowed = new Set([...PAGES, "components/legal/legal-page.tsx", "app/shop/page.tsx", "lib/legal.ts"]);
  // The proxy no longer lists the drafts as public routes unless they are approved.
  const proxy = read("lib/supabase/proxy.ts");
  assert.match(proxy, /\.\.\.\(LEGAL_PAGES_APPROVED \? LEGAL_PATHS : \[\]\)/);
  assert.doesNotMatch(proxy, /["'`]\/(terms|privacy|refunds)["'`]/);
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(root + dir, { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (/\.(ts|tsx)$/.test(e.name) && !allowed.has(rel) && /["'`](\/terms|\/privacy|\/refunds)["'`/?]/.test(read(rel))) offenders.push(rel);
    }
  };
  for (const d of ["app", "components", "lib"]) walk(d);
  assert.deepEqual(offenders, []);
  // /terms-style routes exist only as these three page files (no aliases, redirects or rewrites).
  assert.doesNotMatch(read("next.config.ts"), /terms|privacy|refunds/);
});

test("the published text keeps its draft banner and counsel notes, and makes no compliance or approval claims", () => {
  assert.match(read("components/legal/legal-page.tsx"), /Draft for review/);
  assert.match(read("components/legal/legal-page.tsx"), /not yet been reviewed or approved/);
  assert.match(read("app/terms/page.tsx"), /\[To confirm with counsel/);
  assert.match(read("app/terms/page.tsx"), /Governing law/);
  assert.match(read("app/privacy/page.tsx"), /Optional lead form/);
  assert.match(read("app/refunds/page.tsx"), /Governing law/);
  for (const file of [...PAGES, "components/legal/legal-page.tsx"]) {
    assert.doesNotMatch(read(file), /\b(is|are|fully)\s+(legally\s+)?compliant\b|legally (approved|reviewed|binding)|GDPR[- ]compliant|CCPA[- ]compliant/i, file);
  }
});
