import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { allows, homeFor, sectionOf, TIERS } from "../lib/tier.ts";
import { isBranch, NAV, navFor, type Entry } from "../lib/nav.ts";

// Three purchase tiers, three experiences: the menu and the pages follow the tier.

const labels = (entries: Entry[]): string[] => entries.flatMap((e) => (isBranch(e) ? [e.label, ...labels(e.items)] : [e.label]));
const hrefs = (entries: Entry[]): string[] => entries.flatMap((e) => [...(e.href ? [e.href] : []), ...(isBranch(e) ? hrefs(e.items) : [])]);

describe("tiers", () => {
  test("PTIN sees My Workspace only; ERO adds the ERO Dashboard; Service Bureau adds My Service Bureau", () => {
    const ptin = labels(navFor("ptin"));
    assert.ok(ptin.includes("My Workspace"));
    for (const hidden of ["ERO Dashboard", "My Service Bureau", "My Store", "Leads", "Operations", "Home"]) assert.ok(!ptin.includes(hidden), `${hidden} should be hidden from PTIN`);
    const ero = labels(navFor("ero"));
    assert.ok(ero.includes("My Workspace") && ero.includes("ERO Dashboard"));
    for (const hidden of ["My Service Bureau", "My Store", "Leads", "Operations"]) assert.ok(!ero.includes(hidden), `${hidden} should be hidden from ERO`);
    const bureau = labels(navFor("bureau"));
    for (const shown of ["My Workspace", "ERO Dashboard", "My Service Bureau", "My Store", "Leads", "Operations", "Settings"]) assert.ok(bureau.includes(shown), `${shown} should show for Service Bureau`);
  });

  test("every tier keeps Settings, without the bureau-only pages", () => {
    assert.ok(hrefs(navFor("ptin")).includes("/settings/firm"));
    assert.ok(!hrefs(navFor("ero")).includes("/bureau/settings"));
    assert.ok(hrefs(navFor("bureau")).includes("/bureau/settings"));
  });

  test("My Service Bureau is a header that opens and closes; the dashboard is its first item", () => {
    const sb = NAV[0] && isBranch(NAV[0]) ? NAV[0].items.find((e) => e.label === "My Service Bureau") : undefined;
    assert.ok(sb && isBranch(sb));
    assert.equal(sb.href, undefined);
    assert.deepEqual(sb.items.map((i) => i.label), ["Dashboard", "EROs & EFINs", "Renewals", "Fees & statements", "Office access", "Compliance"]);
    assert.equal(sb.items[0].href, "/efin");
  });

  test("nothing is shown that isn't built: no Soon items, no service orders, courses, memberships, support, marketing or reports", () => {
    const all = labels(NAV);
    for (const gone of ["Service orders", "Courses", "Memberships", "Support", "Marketing", "Reports"]) assert.ok(!all.includes(gone), `${gone} should not be in the menu`);
    const leaves = (entries: Entry[]): Entry[] => entries.flatMap((e) => (isBranch(e) ? leaves(e.items) : [e]));
    assert.deepEqual(leaves(NAV).filter((l) => !l.href).map((l) => l.label), []);
  });

  test("the breadcrumb group is named like the menu group: Settings is its own group", () => {
    assert.ok(NAV.some((e) => e.label === "Settings" && isBranch(e) && e.items.some((i) => i.href === "/settings/firm")));
    const ops = NAV.find((e) => e.label === "Operations");
    assert.ok(ops && isBranch(ops) && !ops.items.some((i) => i.label === "Settings"));
  });

  test("routes belong to sections, and sections to tiers", () => {
    assert.equal(sectionOf("/efin/renewals"), "bureau");
    assert.equal(sectionOf("/ero"), "ero");
    assert.equal(sectionOf("/documents/abc"), "workspace");
    assert.equal(sectionOf("/leads/x"), "leads");
    assert.equal(sectionOf("/orders/internal"), "store");
    assert.equal(sectionOf("/erosion"), null);
    assert.equal(allows("ptin", "workspace"), true);
    assert.equal(allows("ptin", "ero"), false);
    assert.equal(allows("ero", "ero"), true);
    assert.equal(allows("ero", "bureau"), false);
    assert.equal(allows("bureau", "operations"), true);
    assert.deepEqual(TIERS.map(homeFor), ["/workspace", "/ero", "/"]);
  });

  test("every menu link is a page its tier is allowed to open", () => {
    for (const tier of TIERS) for (const href of hrefs(navFor(tier))) {
      const section = sectionOf(href);
      assert.ok(!section || allows(tier, section), `${href} is in the ${tier} menu but its section is not allowed`);
    }
  });

  test("each gated area has a layout that checks the tier", () => {
    const gated = ["efin", "fees", "offices", "compliance", "bureau", "leads", "store", "customers", "orders", "products", "licenses", "installations", "service-orders", "forms", "automation", "ero"];
    for (const dir of gated) {
      const file = `app/(admin)/${dir}/layout.tsx`;
      assert.ok(existsSync(file), `${file} is missing`);
      assert.match(readFileSync(file, "utf8"), /requireSection\("/, `${file} does not check the tier`);
    }
  });

  test("a missing tier column never hides anything: the account is treated as Service Bureau", () => {
    const src = readFileSync("lib/tier-server.ts", "utf8");
    assert.match(src, /if \(error\) return "bureau"/);
    assert.match(src, /catch \{\s*return "bureau"/);
  });
});

describe("menu shape", () => {
  test("My Workspace and ERO Dashboard are separate top-level items of My Office, in order, before My Service Bureau", () => {
    const office = NAV[0];
    assert.ok(isBranch(office));
    const names = office.items.map((i) => i.label);
    assert.ok(names.indexOf("My Workspace") + 1 === names.indexOf("ERO Dashboard"));
    assert.ok(names.indexOf("ERO Dashboard") + 1 === names.indexOf("My Service Bureau"));
    assert.equal(isBranch(office.items[names.indexOf("My Workspace")]), false);
  });

  test("Add PTIN is not gated on having an own-office firm, and the tag filter always renders", () => {
    const ero = readFileSync("app/(admin)/ero/view.tsx", "utf8");
    assert.match(ero, /\{!adding && <Link className="monarch-primary" href="\/ero\?add=1#add-ptin">/);
    const leads = readFileSync("app/(admin)/leads/page.tsx", "utf8");
    assert.match(leads, /aria-label="Filter by tag"/);
    assert.ok(!/tagCounts\.length > 0 \|\| chosen\.length > 0/.test(leads));
  });
});
