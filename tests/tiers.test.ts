import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { allows, homeFor, sectionOf, TIERS } from "../lib/tier.ts";
import { isBranch, NAV, navFor, type Entry } from "../lib/nav.ts";

// Three purchase tiers, three experiences: the menu and the pages follow the tier.

const labels = (entries: Entry[]): string[] => entries.flatMap((e) => (isBranch(e) ? [e.label, ...labels(e.items)] : [e.label]));
const hrefs = (entries: Entry[]): string[] => entries.flatMap((e) => [...(e.href ? [e.href] : []), ...(isBranch(e) ? hrefs(e.items) : [])]);

describe("tiers", () => {
  test("every plan has the daily work, Calendar and Grow; ERO adds the ERO group; Service Bureau adds My Service Bureau, My Store and Leads", () => {
    const daily = ["Every day", "Home", "Contacts", "Work", "Billing", "Calendar", "Documents", "Grow", "Websites", "Forms", "Automation", "Pipelines", "Campaigns", "Settings"];
    const ptin = labels(navFor("ptin"));
    for (const shown of daily) assert.ok(ptin.includes(shown), `${shown} should show for PTIN`);
    for (const hidden of ["ERO Dashboard", "My Service Bureau", "My Store", "Leads"]) assert.ok(!ptin.includes(hidden), `${hidden} should be hidden from PTIN`);
    const ero = labels(navFor("ero"));
    for (const shown of [...daily, "ERO Dashboard"]) assert.ok(ero.includes(shown), `${shown} should show for ERO`);
    for (const hidden of ["My Service Bureau", "My Store", "Leads"]) assert.ok(!ero.includes(hidden), `${hidden} should be hidden from ERO`);
    const bureau = labels(navFor("bureau"));
    for (const shown of [...daily, "ERO Dashboard", "My Service Bureau", "My Store", "Leads"]) assert.ok(bureau.includes(shown), `${shown} should show for Service Bureau`);
  });

  test("every tier keeps Settings, without the bureau-only pages", () => {
    assert.ok(hrefs(navFor("ptin")).includes("/settings/firm"));
    assert.ok(!hrefs(navFor("ero")).includes("/bureau/settings"));
    assert.ok(hrefs(navFor("bureau")).includes("/bureau/settings"));
  });

  test("My Service Bureau is a header that opens and closes; the dashboard is its first item", () => {
    const sb = NAV.find((e) => e.label === "My Service Bureau");
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
    const grow = NAV.find((e) => e.label === "Grow");
    assert.ok(grow && isBranch(grow) && !grow.items.some((i) => i.label === "Settings"));
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
    assert.equal(allows("bureau", "store"), true);
    assert.equal(allows("ero", "store"), false);
    assert.deepEqual(TIERS.map(() => homeFor()), ["/", "/", "/"], "Home is every plan's front page");
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

describe("the Admin area (platform administrators only)", () => {
  const admin = NAV[NAV.length - 1];

  test("Admin is the last item of the menu and holds the platform tools", () => {
    assert.ok(isBranch(admin));
    assert.equal(admin.label, "Admin");
    assert.equal(admin.section, "platform");
    assert.deepEqual(admin.items.map((i) => i.label), ["Workspaces", "Billing setup", "Integrations", "Legal & signup", "Activity"]);
    assert.ok(admin.items.every((i) => i.href?.startsWith("/admin/")));
  });

  test("no tier sees it; only a platform administrator does", () => {
    for (const tier of TIERS) {
      assert.ok(!labels(navFor(tier)).includes("Admin"), `${tier} must not see Admin`);
      assert.ok(!hrefs(navFor(tier)).some((h) => h.startsWith("/admin")), `${tier} must not get any /admin link`);
      assert.equal(allows(tier, "platform"), false);
      const shown = navFor(tier, undefined, undefined, true);
      assert.equal(shown[shown.length - 1].label, "Admin", "a platform administrator sees it last");
    }
    // The platform tools are not left in the tenant menus.
    const all = hrefs(navFor("bureau"));
    for (const gone of ["/settings/billing-setup", "/offices/holders"]) assert.ok(!all.includes(gone), `${gone} moved to Admin`);
  });

  test("everything under /admin is the platform section, and the area guards itself", () => {
    assert.equal(sectionOf("/admin/billing-setup"), "platform");
    assert.equal(sectionOf("/admin"), "platform");
    assert.equal(sectionOf("/administrators"), null);
    const layout = readFileSync("app/(admin)/admin/layout.tsx", "utf8");
    assert.match(layout, /requirePlatformAdmin\(\)/);
    for (const f of ["app/(admin)/admin/billing-setup/page.tsx", "app/(admin)/admin/billing-setup/actions.ts", "app/(admin)/admin/workspaces/page.tsx", "app/(admin)/admin/workspaces/actions.ts", "app/(admin)/admin/integrations/page.tsx"]) {
      const src = readFileSync(f, "utf8");
      assert.match(src, /requirePlatformAdmin\(\)/, `${f} must check for a platform administrator`);
      assert.doesNotMatch(src, /requireAdmin\(\)|requireSection\("(?!platform)/, `${f} must not rely on the broader checks`);
    }
  });

  test("requireSection('platform') never lets a tier decide", () => {
    assert.match(readFileSync("lib/tier-server.ts", "utf8"), /section === "platform"\) return \{ \.\.\.\(await requirePlatformAdmin\(\)\)/);
  });

  test("the old addresses lead to the new ones", () => {
    const cfg = readFileSync("next.config.ts", "utf8");
    assert.match(cfg, /source: "\/settings\/billing-setup", destination: "\/admin\/billing-setup"/);
    assert.match(cfg, /source: "\/offices\/holders", destination: "\/admin\/workspaces"/);
  });

  test("platform connection health is in Admin; the calculator setup links stay in Monarch's settings", () => {
    assert.match(readFileSync("app/(admin)/admin/integrations/page.tsx", "utf8"), /integrationStatus/);
    const links = readFileSync("app/(admin)/settings/integrations/page.tsx", "utf8");
    assert.doesNotMatch(links, /integrationStatus/);
    assert.match(links, /Customer setup links/);
  });
});

describe("menu shape", () => {
  test("the menu groups come in this order, and the store has a group of its own", () => {
    assert.deepEqual(NAV.map((g) => g.label), ["Every day", "Grow", "ERO", "My Service Bureau", "My Store", "Settings", "Admin"]);
    const store = NAV.find((g) => g.label === "My Store");
    assert.ok(store && isBranch(store));
    assert.ok(!labels(NAV.filter((g) => g.label !== "My Store")).includes("Orders"), "the store's pages are only in the store group");
  });

  test("the daily group lists the daily work in order", () => {
    const daily = NAV[0];
    assert.ok(isBranch(daily));
    assert.deepEqual(daily.items.map((i) => i.label), ["Home", "Contacts", "Work", "Billing", "Calendar", "Documents"]);
  });

  test("Calendar, Websites, Forms, Automation and Campaigns are open to every plan, and their pages are gated the same way", () => {
    for (const path of ["/calendar", "/sites", "/forms", "/automation/workflows", "/campaigns"]) {
      assert.equal(sectionOf(path), "workspace", path);
      assert.equal(allows("ptin", sectionOf(path)!), true, path);
    }
    for (const layout of ["app/(admin)/forms/layout.tsx", "app/(admin)/automation/layout.tsx"]) assert.match(readFileSync(layout, "utf8"), /requireSection\("workspace"\)/);
  });

  test("the removed My Tax Office page leads to Home, and nothing links to it", () => {
    assert.match(readFileSync("next.config.ts", "utf8"), /source: "\/workspace", destination: "\/"/);
    assert.equal(existsSync("app/(admin)/workspace/page.tsx"), false);
    assert.ok(!labels(NAV).includes("My Workspace"));
  });

  test("Add PTIN is not gated on having an own-office firm, and the tag filter always renders", () => {
    const ero = readFileSync("app/(admin)/ero/view.tsx", "utf8");
    assert.match(ero, /\{!adding && <Link className="monarch-primary" href="\/ero\?add=1#add-ptin">/);
    const leads = readFileSync("app/(admin)/leads/page.tsx", "utf8");
    assert.match(leads, /aria-label="Filter by tag"/);
    assert.ok(!/tagCounts\.length > 0 \|\| chosen\.length > 0/.test(leads));
  });
});
