// Leads: every prospect in one list, whatever funnel they came from. Lead → Customer (on purchase) → Firm (for EROs).

export const LEAD_SOURCES = {
  wisp_audit: "WISP audit",
  facebook_group: "Facebook group",
  referral: "Referral",
  website: "Website",
  manual: "Manual",
  other: "Other",
} as const;
export type LeadSource = keyof typeof LEAD_SOURCES;
export const SOURCE_KEYS = Object.keys(LEAD_SOURCES) as LeadSource[];

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
  created_at: string;
  updated_at: string;
};

export type LeadEvent = { id: string; tenant_id: string; lead_id: string; action: string; detail: Record<string, unknown>; actor_id: string | null; created_at: string };

/** `tags`: a lead must carry every tag listed. */
export type LeadFilter = { q?: string; source?: LeadSource; status?: LeadStatus; tags?: string[]; from?: string; to?: string; limit?: number };

export type LeadInsert = Omit<Lead, "id" | "tenant_id" | "created_at" | "updated_at">;

export interface LeadsRepo {
  listLeads(filter: LeadFilter): Promise<Lead[]>;
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
