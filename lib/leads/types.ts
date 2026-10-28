// Leads: every prospect in one list, whatever funnel they came from. Lead → Customer (on purchase) → Firm (for EROs).

/**
 * Where a lead came from is a label set automatically by how they arrived, and editable afterwards. These are the
 * built-in ones; a form, funnel, page or import adds its own ("Form: Intake", "Import: Facebook group Oct").
 */
export const LEAD_SOURCES: Record<string, string> = {
  wisp_audit: "WISP audit",
  wisp_builder: "WISP builder",
  facebook_group: "Facebook group",
  referral: "Referral",
  website: "Website",
  manual: "Manual",
  other: "Other",
};
export type LeadSource = string;
export const SOURCE_MAX = 120;

/** The label for each way a lead can arrive. */
export const leadSource = {
  manual: "manual",
  form: (name: string) => `Form: ${name}`.slice(0, SOURCE_MAX),
  funnel: (name: string) => `Funnel: ${name}`.slice(0, SOURCE_MAX),
  page: (name: string) => `Page: ${name}`.slice(0, SOURCE_MAX),
  import: (name: string) => `Import: ${name}`.slice(0, SOURCE_MAX),
};
export const sourceName = (s: string) => LEAD_SOURCES[s] ?? s;

export const LEAD_STATUSES = {
  new: "New",
  contacted: "Contacted",
  interested: "Interested",
  converted: "Converted",
  lost: "Lost",
} as const;
export type LeadStatus = keyof typeof LEAD_STATUSES;
export const STATUS_KEYS = Object.keys(LEAD_STATUSES) as LeadStatus[];

export type Lead = {
  id: string;
  tenant_id: string;
  full_name: string;
  email: string;
  phone: string | null;
  firm_name: string | null;
  source: LeadSource;
  status: LeadStatus;
  notes: string | null;
  tags: string[];
  last_contacted_at: string | null;
  audit_id: string | null;
  audit_score: number | null;
  wisp_plan_id: string | null;
  customer_id: string | null;
  order_id: string | null;
  organization_id: string | null;
  converted_at: string | null;
  /** The teammate this lead is assigned to (a workspace member), or none. */
  assigned_to?: string | null;
  created_at: string;
  updated_at: string;
};

export type LeadEvent = { id: string; tenant_id: string; lead_id: string; action: string; detail: Record<string, unknown>; actor_id: string | null; created_at: string };

/** `tags`: a lead must carry every tag listed. */
export type LeadFilter = { q?: string; source?: LeadSource; status?: LeadStatus; tags?: string[]; from?: string; to?: string; limit?: number };

export type LeadInsert = Omit<Lead, "id" | "tenant_id" | "created_at" | "updated_at">;

export interface LeadsRepo {
  listLeads(filter: LeadFilter): Promise<Lead[]>;
  /** Every source in use, with how many leads came from it, for the source filter. */
  sourceCounts(): Promise<{ source: string; count: number }[]>;
  /** Every tag in use, with how many leads carry it, for suggestions and the tag filter. */
  tagCounts(): Promise<{ tag: string; count: number }[]>;
  getLead(id: string): Promise<Lead | null>;
  findByEmail(email: string): Promise<Lead | null>;
  findByAudit(auditId: string): Promise<Lead | null>;
  existingEmails(emails: string[]): Promise<Set<string>>;
  insertLead(input: LeadInsert): Promise<Lead>;
  updateLead(id: string, patch: Partial<Lead>): Promise<Lead>;
  deleteLead(id: string): Promise<void>;
  addEvent(e: Omit<LeadEvent, "id" | "tenant_id" | "created_at">): Promise<void>;
  listEvents(leadId: string): Promise<LeadEvent[]>;
}

export type LeadsDeps = { repo: LeadsRepo; now?: () => Date };
