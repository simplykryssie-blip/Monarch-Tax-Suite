// Three purchase tiers, three experiences. A tier decides which parts of the app an account sees:
//   ptin   : the daily work (Home, Contacts, Returns, Billing, Calendar, Documents), Grow (Websites, Forms, Automation, Campaigns) and Settings
//   ero    : all of that + the ERO Dashboard (their own EFIN and PTINs)
//   bureau : everything, including My Service Bureau, the store and Leads
// The tier is stored on the tenant (tenants.tier); an account without one is treated as bureau, so nothing disappears.

export const TIERS = ["ptin", "ero", "bureau"] as const;
export type Tier = (typeof TIERS)[number];
export const isTier = (v: unknown): v is Tier => typeof v === "string" && (TIERS as readonly string[]).includes(v);

/** "platform" is the Verexa HQ Admin area. It belongs to no tier: only a platform administrator can open it (see lib/admin.ts). */
export type Section = "workspace" | "ero" | "bureau" | "leads" | "store" | "settings" | "platform";

/** The lowest tier that includes each section. The platform Admin area is in no tier. */
const FROM: Record<Exclude<Section, "platform">, Tier> = { workspace: "ptin", settings: "ptin", ero: "ero", bureau: "bureau", leads: "bureau", store: "bureau" };

const RANK: Record<Tier, number> = { ptin: 0, ero: 1, bureau: 2 };
export const allows = (tier: Tier, section: Section) => section !== "platform" && RANK[tier] >= RANK[FROM[section]];

/** Where each section lives. The first prefix that matches a path decides. */
const ROUTES: [string, Section][] = [
  ["/workspace", "workspace"], ["/documents", "workspace"], ["/reports", "workspace"], ["/contacts", "workspace"],
  ["/ero", "ero"],
  ["/efin", "bureau"], ["/fees", "bureau"], ["/offices", "bureau"], ["/compliance", "bureau"], ["/bureau", "bureau"],
  ["/leads", "leads"],
  ["/store", "store"], ["/customers", "store"], ["/orders", "store"], ["/products", "store"], ["/licenses", "store"], ["/installations", "store"], ["/service-orders", "store"],
  ["/automation", "workspace"], ["/forms", "workspace"], ["/calendar", "workspace"], ["/sites", "workspace"], ["/campaigns", "workspace"],
  ["/settings/integrations", "bureau"],
  ["/settings/store-payments", "store"],
  ["/settings", "settings"],
  ["/admin", "platform"],
];

export function sectionOf(pathname: string): Section | null {
  const hit = ROUTES.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  return hit ? hit[1] : null;
}

/** A page this tier can't open: where to send them instead. */
/** Where an account lands, and where a page its plan lacks sends it: Home, which every plan has. */
export const homeFor = (): string => "/";
