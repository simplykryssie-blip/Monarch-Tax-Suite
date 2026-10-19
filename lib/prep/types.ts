import type { AuditInput } from "../practice/service.ts";
import type { WorkspaceRepo } from "../workspace/types.ts";

// The return-prep and assignment layer, built once. The independent PTIN holder's workspace and the office area both
// use it; they differ only in the scope they pass in.

/**
 * Whose work a person sees. `all`: everything in their account (or office); otherwise only the clients they own and
 * the returns assigned to them. `organizationId`: the office the person works in, or null for the account's own work.
 */
export type Scope = { userId: string; all: boolean; organizationId: string | null };

export type ChecklistItem = { id: string; tenant_id: string; return_id: string; label: string; position: number; done_at: string | null; done_by: string | null; created_at: string };
export type Handoff = { id: string; tenant_id: string; return_id: string; to_email: string; file_name: string; file_sha256: string; status: "sent" | "failed"; error: string | null; sent_by: string | null; created_at: string };

export interface PrepRepo {
  listChecklist(returnId: string): Promise<ChecklistItem[]>;
  insertChecklist(returnId: string, labels: string[], startAt: number): Promise<ChecklistItem[]>;
  getChecklistItem(id: string): Promise<ChecklistItem | null>;
  updateChecklistItem(id: string, patch: Partial<Pick<ChecklistItem, "done_at" | "done_by">>): Promise<ChecklistItem>;
  deleteChecklistItem(id: string): Promise<void>;
  insertHandoff(input: Pick<Handoff, "return_id" | "to_email" | "file_name" | "file_sha256" | "status" | "error" | "sent_by">): Promise<Handoff>;
  listHandoffs(returnId: string): Promise<Handoff[]>;
}

export type PrepDeps = {
  ws: WorkspaceRepo;
  prep: PrepRepo;
  /** The tenant's audit history. */
  audit: (input: AuditInput) => Promise<void>;
  now?: () => Date;
};
