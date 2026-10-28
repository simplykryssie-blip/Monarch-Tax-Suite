import type { LineKey, TaxReturn } from "./engine.ts";

// Monarch Tax Lab domain types. Plain data, so the rules in service.ts run against Supabase in production and an
// in-memory store in tests.

export const LAB_LEVELS = ["Beginner", "Intermediate", "Advanced"] as const;
export type LabLevel = (typeof LAB_LEVELS)[number];
export type LabKind = "instructor" | "student";
export type IntakeMode = "notes" | "interview";

/** Training terms recorded when a license key is activated. */
export type LabTerms = {
  license_id: string;
  kind: LabKind;
  seats: number;
  activated_by: string | null;
  starts_at: string;
  expires_at: string;
  created_at?: string;
  updated_at?: string;
};

export type LabMember = {
  id: string;
  license_id: string;
  user_id: string | null;
  email: string;
  display_name: string | null;
  role: LabKind;
  status: "invited" | "active" | "removed";
  invite_token_hash: string | null;
  invite_expires_at: string | null;
  joined_at: string | null;
  created_at: string;
  updated_at?: string;
};

export type Fact = { label: string; value: string };

/** Which practice documents are built from the answer key and shown to students. */
export const DOC_OPTIONS = [
  ["household", "Household roster (names, SSNs, ages, months lived)"],
  ["w2", "W-2 forms"],
  ["int", "1099-INT forms"],
  ["div", "1099-DIV forms"],
  ["g", "1099-G forms"],
  ["r", "1099-R forms"],
  ["ssa", "SSA-1099 statements"],
  ["nec", "1099-NEC forms"],
] as const;
export type DocOption = (typeof DOC_OPTIONS)[number][0];
export type DocOptions = Partial<Record<DocOption, boolean>>;

/** Practice copies of the documents the client brought, built from the answer key's entries. */
export type SourceDocs = {
  household?: { role: string; name: string; info: string }[];
  w2?: { employer: string; ein: string; employee: string; ssn: string; wages: number; fedwh: number }[];
  int?: { payer: string; recipient: string; amt: number; fedwh: number; exempt: number }[];
  div?: { payer: string; recipient: string; ord: number; qual: number; capd: number; fedwh: number }[];
  g?: { payer: string; recipient: string; unemp: number; fedwh: number }[];
  r?: { payer: string; recipient: string; gross: number; taxable: number | null; fedwh: number; code: string; ira: boolean }[];
  ssa?: { recipient: string; net: number; fedwh: number }[];
  nec?: { payer: string; recipient: string; amt: number }[];
};

export type LabScenario = {
  id: string;
  /** null = the Monarch library; otherwise a private scenario of that license (an instructor's class). */
  license_id: string | null;
  tax_year: number;
  status: "draft" | "published";
  title: string;
  level: LabLevel;
  summary: string | null;
  narrative: string;
  facts: Fact[];
  intake_mode: IntakeMode;
  doc_options: DocOptions;
  documents: SourceDocs;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type LabKey = {
  scenario_id: string;
  ret: TaxReturn;
  line_values: Partial<Record<LineKey, number>>;
  overrides: Partial<Record<LineKey, number>>;
  checks: LineKey[];
  updated_at?: string;
};

export type LabWork = {
  id: string;
  member_id: string;
  scenario_id: string;
  ret: Record<string, unknown>;
  intake: Record<string, string | boolean>;
  checks_run: number;
  status: "draft" | "submitted" | "graded";
  submitted_ret: Record<string, unknown> | null;
  submitted_intake: Record<string, string | boolean> | null;
  note: string | null;
  correct: number | null;
  total: number | null;
  efile_rejects: number | null;
  submitted_at: string | null;
  grade: "pass" | "revise" | null;
  score: string | null;
  feedback: string | null;
  graded_by: string | null;
  graded_at: string | null;
  created_at: string;
  updated_at: string;
};

export type NewMember = Omit<LabMember, "id" | "created_at" | "updated_at">;
export type ScenarioInput = Omit<LabScenario, "created_at" | "updated_at">;

export interface LabRepo {
  getTerms(licenseId: string): Promise<LabTerms | null>;
  createTerms(terms: LabTerms): Promise<LabTerms>;
  membersForUser(userId: string): Promise<LabMember[]>;
  membersOfLicense(licenseId: string): Promise<LabMember[]>;
  getMember(id: string): Promise<LabMember | null>;
  memberByInviteHash(hash: string): Promise<LabMember | null>;
  createMember(member: NewMember): Promise<LabMember>;
  updateMember(id: string, patch: Partial<LabMember>): Promise<LabMember>;
  /** The library plus the private scenarios of the given licenses. */
  listScenarios(licenseIds: string[]): Promise<LabScenario[]>;
  getScenario(id: string): Promise<LabScenario | null>;
  saveScenario(s: ScenarioInput): Promise<LabScenario>;
  deleteScenario(id: string): Promise<void>;
  getKey(scenarioId: string): Promise<LabKey | null>;
  saveKey(key: LabKey): Promise<LabKey>;
  getWork(memberId: string, scenarioId: string): Promise<LabWork | null>;
  getWorkById(id: string): Promise<LabWork | null>;
  workForMembers(memberIds: string[]): Promise<LabWork[]>;
  saveWork(work: Partial<LabWork> & { member_id: string; scenario_id: string }): Promise<LabWork>;
}

/** The commerce lookups activation needs (a subset of CommerceRepo). */
export type LabCommercePort = {
  findLicenseByKeyHash(hash: string): Promise<{ id: string; product_id: string; status: string } | null>;
  getProduct(id: string): Promise<{ id: string; name: string; metadata: Record<string, string> } | null>;
};
