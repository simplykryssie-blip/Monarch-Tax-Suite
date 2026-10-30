import type { IconName } from "@/components/admin/icons";
import { allows, type Section, type Tier } from "./tier.ts";

export type Leaf = { label: string; icon: IconName; href?: string; section?: Section; /** A full web address on another site: opened as a plain link, not a page of this app. */ external?: boolean };
export type Branch = { label: string; icon: IconName; href?: string; section?: Section; items: (Leaf | Branch)[] };
export type Entry = Leaf | Branch;
export const isBranch = (e: Entry): e is Branch => "items" in e;

// What each tier sees is decided by `section` (see lib/tier.ts); an entry without one follows the group it sits in.
// An item that isn't built yet is left out of the menu rather than shown as "Coming soon".
export const NAV: Entry[] = [
  {
    // The daily work, in the order a tax office reaches for it. Every plan has these.
    label: "Every day",
    icon: "office",
    section: "workspace",
    items: [
      { label: "Home", icon: "dashboard", href: "/" },
      { label: "Contacts", icon: "user", href: "/contacts" },
      { label: "Work", icon: "checklist", href: "/workspace/work" },
      { label: "Billing", icon: "card", href: "/workspace/billing" },
      { label: "Calendar", icon: "calendar", href: "/calendar" },
      { label: "Documents", icon: "reports", href: "/documents" },
      { label: "Reports", icon: "reports", href: "/reports" },
    ],
  },
  {
    label: "Grow",
    icon: "marketing",
    section: "workspace",
    items: [
      { label: "Websites", icon: "store", href: "/sites" },
      { label: "Forms", icon: "checklist", href: "/forms" },
      { label: "Automation", icon: "automation", href: "/automation/workflows" },
      { label: "Pipelines", icon: "checklist", href: "/pipelines" },
      { label: "Campaigns", icon: "marketing", href: "/campaigns" },
      { label: "Leads", icon: "user", href: "/leads", section: "leads" },
    ],
  },
  {
    label: "ERO",
    icon: "licenses",
    section: "ero",
    items: [{ label: "ERO Dashboard", icon: "dashboard", href: "/ero" }],
  },
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
    // The store has a group of its own.
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
    ],
  },
  {
    label: "Settings",
    icon: "settings",
    section: "settings",
    items: [
      { label: "Firm profile", icon: "office", href: "/settings/firm" },
      { label: "Branding", icon: "office", href: "/settings/branding" },
      { label: "Team", icon: "office", href: "/settings/team", section: "ero" },
      { label: "Security", icon: "shield", href: "/settings/security" },
      { label: "Email and text", icon: "bell", href: "/settings/email" },
      { label: "Booking and hours", icon: "calendar", href: "/settings/calendar" },
      { label: "Tags", icon: "checklist", href: "/settings/tags" },
      { label: "Payments", icon: "card", href: "/settings/payments" },
      { label: "Invoice settings", icon: "card", href: "/settings/billing" },
      { label: "Store payments", icon: "card", href: "/settings/store-payments", section: "store" },
      { label: "Package attributes", icon: "checklist", href: "/settings/package-attributes" },
      { label: "Activity log", icon: "reports", href: "/settings/archive" },
      { label: "Calculator setup links", icon: "licenses", href: "/settings/integrations", section: "bureau" },
      { label: "Software & banking", icon: "settings", href: "/bureau/settings", section: "bureau" },
      { label: "History", icon: "reports", href: "/bureau/settings/history", section: "bureau" },
    ],
  },
  {
    // Verexa HQ's own tools, last in the menu. Only a platform administrator sees or can open this; no workspace does.
    label: "Admin",
    icon: "shield",
    section: "platform",
    items: [
      { label: "Workspaces", icon: "customers", href: "/admin/workspaces" },
      { label: "Billing setup", icon: "card", href: "/admin/billing-setup" },
      { label: "Integrations", icon: "licenses", href: "/admin/integrations" },
      { label: "Legal & signup", icon: "checklist", href: "/admin/legal" },
      { label: "Activity", icon: "reports", href: "/admin/activity" },
    ],
  },
];

/** The menu for one tier: entries outside the tier are removed, and so are groups left with nothing in them. The Admin group appears only for a platform administrator. */
export function navFor(tier: Tier, entries: Entry[] = NAV, inherited: Section | undefined = undefined, platformAdmin = false): Entry[] {
  const out: Entry[] = [];
  for (const e of entries) {
    const section = e.section ?? inherited;
    if (section === "platform" ? !platformAdmin : section && !allows(tier, section)) continue;
    if (isBranch(e)) {
      const items = navFor(tier, e.items, section, platformAdmin);
      if (items.length) out.push({ ...e, items });
    } else out.push(e);
  }
  return out;
}
