// Who can reach what in the office area. One catalog of features, each with the lowest role that has it:
// PTIN holder (preparer) < ERO < Service Bureau. A higher role inherits everything below it. For preparers, the ERO
// decides feature by feature: PTIN-level features are on unless the ERO turns them off, and the ERO can also hand a
// preparer some ERO-level features. Managing the team is never delegated.

export const ROLES = ["preparer", "ero", "bureau"] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABEL: Record<Role, string> = { preparer: "PTIN holder (preparer)", ero: "ERO", bureau: "Service bureau" };
const RANK: Record<Role, number> = { preparer: 1, ero: 2, bureau: 3 };

export type Feature = {
  key: string;
  label: string;
  level: Role;
  /** "live" features have a page today; "soon" ones arrive with a later Phase 3 piece and are shown, not linked. */
  status: "live" | "soon";
  href?: string;
  /** Never handed to a preparer, whatever the ERO sets. */
  eroOnly?: boolean;
  /** Not shown to the bureau when it opens an office: the bureau sees compliance status, not the office's files. */
  bureauHidden?: boolean;
  note?: string;
};

export const FEATURES: Feature[] = [
  { key: "office.home", label: "Home", level: "preparer", status: "live", href: "/office" },
  { key: "clients.intake", label: "Client intake", level: "preparer", status: "soon", note: "Arrives with the Return Pipeline." },
  { key: "returns.prep", label: "Return preparation", level: "preparer", status: "soon", note: "Arrives with the Return Pipeline." },
  { key: "returns.assigned", label: "My assigned returns", level: "preparer", status: "soon", note: "Arrives with the Return Pipeline." },
  { key: "compliance.home", label: "Compliance", level: "preparer", status: "live", href: "/office/compliance", note: "WISP acknowledgment, PTIN renewal, reporting an incident." },
  { key: "office.dashboard", label: "Office dashboard", level: "ero", status: "live", href: "/office" },
  { key: "fees.view", label: "Fees & statement", level: "ero", status: "live", href: "/office/statement" },
  { key: "efile.manage", label: "E-file management", level: "ero", status: "soon", note: "Arrives with the Return Pipeline." },
  { key: "team.manage", label: "Team & permissions", level: "ero", status: "live", href: "/office/team", eroOnly: true },
  { key: "compliance.manage", label: "Compliance management", level: "ero", status: "live", href: "/office/compliance/wisp", note: "Attest the WISP, the office checklist, reminder settings, PTIN records for the team." },
  { key: "compliance.incidents", label: "Incident response", level: "ero", status: "live", href: "/office/compliance/incidents", note: "Work through incidents and close them." },
  { key: "compliance.8879", label: "Form 8879 records", level: "ero", status: "live", href: "/office/compliance/8879", bureauHidden: true },
  { key: "compliance.vault", label: "Document vault", level: "ero", status: "live", href: "/office/compliance/vault", bureauHidden: true },
  { key: "eros.manage", label: "ERO management", level: "bureau", status: "live", href: "/efin/list" },
  { key: "offices.all", label: "All offices", level: "bureau", status: "live", href: "/fees" },
];

export const featureOf = (key: string) => FEATURES.find((f) => f.key === key);
/** The features an ERO can switch on or off for a preparer. */
export const DELEGABLE = FEATURES.filter((f) => !f.eroOnly && f.level !== "bureau" && f.key !== "office.home");

export type Permissions = Record<string, boolean>;

/** Whether a member with this role and these ERO-set permissions can use a feature. */
export function can(role: Role, permissions: Permissions, key: string): boolean {
  const f = featureOf(key);
  if (!f) return false;
  if (key === "office.home") return true;
  if (role === "bureau" && f.bureauHidden) return false;
  if (RANK[role] < RANK[f.level]) {
    // Below the feature's level: only a preparer, and only when their ERO handed it to them.
    return role === "preparer" && f.level === "ero" && !f.eroOnly && permissions[key] === true;
  }
  if (role === "preparer") return permissions[key] !== false;
  return true;
}

/** The features this member can reach, in catalog order. */
export const featuresFor = (role: Role, permissions: Permissions) => FEATURES.filter((f) => can(role, permissions, f.key));

/** A preparer's permissions from a form: only known, delegable keys, as true/false. */
export function cleanPermissions(raw: Record<string, unknown>): Permissions {
  const out: Permissions = {};
  for (const f of DELEGABLE) {
    if (raw[f.key] === undefined) continue;
    out[f.key] = raw[f.key] === true || raw[f.key] === "on" || raw[f.key] === "yes";
  }
  return out;
}

/** What a preparer gets before the ERO changes anything: every PTIN-level feature, no ERO-level ones. */
export const defaultPermissions = (): Permissions => Object.fromEntries(DELEGABLE.map((f) => [f.key, f.level === "preparer"]));
