import type { IconName } from "@/components/admin/icons";
import { allows, type Section, type Tier } from "./tier.ts";

export type Leaf = { label: string; icon: IconName; href?: string; section?: Section };
export type Branch = { label: string; icon: IconName; href?: string; section?: Section; items: (Leaf | Branch)[] };
export type Entry = Leaf | Branch;
export const isBranch = (e: Entry): e is Branch => "items" in e;

// What each tier sees is decided by `section` (see lib/tier.ts); an entry without one follows the group it sits in.
// An item that isn't built yet is left out of the menu rather than shown as "Coming soon".
export const NAV: Entry[] = [
  {
    label: "My Office",
    icon: "office",
    items: [
      { label: "Home", icon: "dashboard", href: "/", section: "bureau" },
      { label: "Leads", icon: "user", href: "/leads", section: "leads" },
      { label: "My Workspace", icon: "firms", href: "/workspace", section: "workspace" },
      { label: "ERO Dashboard", icon: "licenses", href: "/ero", section: "ero" },
      {
        // A section header only: it opens and closes; the dashboard is the first item inside it.
        label: "My Service Bureau",
        icon: "licenses",
        section: "bureau",
        items: [
          { label: "Dashboard", icon: "dashboard", href: "/efin" },
          { label: "EROs & EFINs", icon: "firms", href: "/efin/list" },
          { label: "Renewals", icon: "bell", href: "/efin/renewals" },
          { label: "Fees & statements", icon: "reports", href: "/fees" },
          { label: "Office access", icon: "customers", href: "/offices" },
          { label: "Compliance", icon: "shield", href: "/compliance" },
        ],
      },
      {
        label: "My Store",
        icon: "store",
        section: "store",
        items: [
          { label: "Dashboard", icon: "reports", href: "/store" },
          { label: "Customers", icon: "customers", href: "/customers" },
          { label: "Orders", icon: "orders", href: "/orders" },
          { label: "Products", icon: "products", href: "/products" },
          { label: "Licenses", icon: "licenses", href: "/licenses" },
          { label: "Installations", icon: "installs", href: "/installations" },
          { label: "WISP Generator", icon: "checklist", href: "/store/wisp" },
        ],
      },
    ],
  },
  {
    label: "Operations",
    icon: "automation",
    section: "operations",
    items: [
      { label: "Automation", icon: "automation", href: "/automation/workflows" },
      { label: "Forms", icon: "checklist", href: "/forms" },
    ],
  },
  {
    label: "Settings",
    icon: "settings",
    section: "settings",
    items: [
      { label: "Firm profile", icon: "office", href: "/settings/firm" },
      { label: "Branding", icon: "office", href: "/settings/branding" },
      { label: "Email sending", icon: "bell", href: "/settings/email" },
      { label: "Text messaging", icon: "bell", href: "/settings/sms" },
      { label: "Package attributes", icon: "checklist", href: "/settings/package-attributes" },
      { label: "Archive history", icon: "reports", href: "/settings/archive" },
      { label: "Integrations", icon: "licenses", href: "/settings/integrations", section: "bureau" },
      { label: "Software & banking", icon: "settings", href: "/bureau/settings", section: "bureau" },
      { label: "History", icon: "reports", href: "/bureau/settings/history", section: "bureau" },
    ],
  },
];

/** The menu for one tier: entries outside the tier are removed, and so are groups left with nothing in them. */
export function navFor(tier: Tier, entries: Entry[] = NAV, inherited: Section | undefined = undefined): Entry[] {
  const out: Entry[] = [];
  for (const e of entries) {
    const section = e.section ?? inherited;
    if (section && !allows(tier, section)) continue;
    if (isBranch(e)) {
      const items = navFor(tier, e.items, section);
      if (items.length) out.push({ ...e, items });
    } else out.push(e);
  }
  return out;
}
