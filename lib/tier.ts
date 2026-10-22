// Three purchase tiers, three experiences. A tier decides which parts of the app an account sees:
//   ptin   : My Workspace (their own client work and documents)
//   ero    : My Workspace + the ERO Dashboard (their own EFIN and PTINs)
//   bureau : everything, including My Service Bureau, the store, leads and operations tools
// The tier is stored on the tenant (tenants.tier); an account without one is treated as bureau, so nothing disappears.

export const TIERS = ["ptin", "ero", "bureau"] as const;
export type Tier = (typeof TIERS)[number];
export const TIER_LABEL: Record<Tier, string> = { ptin: "PTIN", ero: "ERO", bureau: "Service Bureau" };
export const isTier = (v: unknown): v is Tier => typeof v === "string" && (TIERS as readonly string[]).includes(v);

/** "platform" is the Verexa HQ Admin area. It belongs to no tier: only a platform administrator can open it (see lib/admin.ts). */
export type Section = "workspace" | "ero" | "bureau" | "leads" | "store" | "operations" | "settings" | "platform";

/** The lowest tier that includes each section. The platform Admin area is in no tier. */
const FROM: Record<Exclude<Section, "platform">, Tier> = { workspace: "ptin", settings: "ptin", ero: "ero", bureau: "bureau", leads: "bureau", store: "bureau", operations: "bureau" };

const RANK: Record<Tier, number> = { ptin: 0, ero: 1, bureau: 2 };
export const allows = (tier: Tier, section: Section) => section !== "platform" && RANK[tier] >= RANK[FROM[section]];

/** Where each section lives. The first prefix that matches a path decides. */
const ROUTES: [string, Section][] = [
  ["/workspace", "workspace"], ["/documents", "workspace"],
  ["/ero", "ero"],
  ["/efin", "bureau"], ["/fees", "bureau"], ["/offices", "bureau"], ["/compliance", "bureau"], ["/bureau", "bureau"],
  ["/leads", "leads"],
  ["/store", "store"], ["/customers", "store"], ["/orders", "store"], ["/products", "store"], ["/licenses", "store"], ["/installations", "store"], ["/service-orders", "store"],
  ["/automation", "operations"], ["/forms", "operations"], ["/calendar", "operations"], ["/sites", "operations"], ["/campaigns", "operations"],
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
export const homeFor = (tier: Tier): string => (tier === "bureau" ? "/" : tier === "ero" ? "/ero" : "/workspace");
