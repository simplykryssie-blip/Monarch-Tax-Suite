// Three purchase tiers, three experiences. A tier decides which parts of the app an account sees:
//   ptin   : My Workspace (their own client work and documents)
//   ero    : My Workspace + the ERO Dashboard (their own EFIN and PTINs)
//   bureau : everything, including My Service Bureau, the store, leads and operations tools
// The tier is stored on the tenant (tenants.tier); an account without one is treated as bureau, so nothing disappears.

export const TIERS = ["ptin", "ero", "bureau"] as const;
export type Tier = (typeof TIERS)[number];
export const TIER_LABEL: Record<Tier, string> = { ptin: "PTIN", ero: "ERO", bureau: "Service Bureau" };
export const isTier = (v: unknown): v is Tier => typeof v === "string" && (TIERS as readonly string[]).includes(v);

export type Section = "workspace" | "ero" | "bureau" | "leads" | "store" | "operations" | "settings";

/** The lowest tier that includes each section. */
const FROM: Record<Section, Tier> = { workspace: "ptin", settings: "ptin", ero: "ero", bureau: "bureau", leads: "bureau", store: "bureau", operations: "bureau" };

const RANK: Record<Tier, number> = { ptin: 0, ero: 1, bureau: 2 };
export const allows = (tier: Tier, section: Section) => RANK[tier] >= RANK[FROM[section]];

/** Where each section lives. The first prefix that matches a path decides. */
const ROUTES: [string, Section][] = [
  ["/workspace", "workspace"], ["/documents", "workspace"],
  ["/ero", "ero"],
  ["/efin", "bureau"], ["/fees", "bureau"], ["/offices", "bureau"], ["/compliance", "bureau"], ["/bureau", "bureau"],
  ["/leads", "leads"],
  ["/store", "store"], ["/customers", "store"], ["/orders", "store"], ["/products", "store"], ["/licenses", "store"], ["/installations", "store"], ["/service-orders", "store"],
  ["/automation", "operations"], ["/forms", "operations"], ["/calendar", "operations"], ["/sites", "operations"],
  ["/settings/integrations", "bureau"],
  ["/settings", "settings"],
];

export function sectionOf(pathname: string): Section | null {
  const hit = ROUTES.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  return hit ? hit[1] : null;
}

/** A page this tier can't open: where to send them instead. */
export const homeFor = (tier: Tier): string => (tier === "bureau" ? "/" : tier === "ero" ? "/ero" : "/workspace");
