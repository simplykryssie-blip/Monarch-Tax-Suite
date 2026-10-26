// Pipelines: the stages a piece of work moves through, built visually under Automations. The "returns" pipeline
// is the one the My Work board uses.

export type Stage = { id: string; name: string; color: string; /** Work that reaches this stage is finished. */ done: boolean };
export type PipelineKind = "returns" | "custom";
export type Pipeline = {
  id: string;
  tenant_id: string;
  name: string;
  kind: PipelineKind;
  stages: Stage[];
  is_default: boolean;
  /** What it is for, in the office's own words. */
  type_label?: string | null;
  color?: string | null;
  /** Only a published pipeline is offered on the Work board, the Add popup and in workflows. */
  published?: boolean;
  folder_id?: string | null;
  archived_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};
export type PipelineInput = Pick<Pipeline, "name" | "kind" | "stages"> & Partial<Pick<Pipeline, "type_label" | "color" | "published" | "folder_id">>;
export type PipelineFolder = { id: string; tenant_id: string; name: string; parent_id: string | null; created_at: string };
export type PipelinePatch = Partial<Pick<Pipeline, "name" | "stages" | "is_default" | "archived_at" | "type_label" | "color" | "published" | "folder_id">>;

export interface PipelinesRepo {
  list(): Promise<Pipeline[]>;
  get(id: string): Promise<Pipeline | null>;
  insert(input: PipelineInput & { is_default: boolean; created_by: string | null }): Promise<Pipeline>;
  update(id: string, patch: PipelinePatch): Promise<Pipeline>;
  listFolders(): Promise<PipelineFolder[]>;
  insertFolder(input: { name: string; parent_id: string | null; created_by: string | null }): Promise<PipelineFolder>;
  updateFolder(id: string, patch: Partial<Pick<PipelineFolder, "name" | "parent_id">>): Promise<PipelineFolder>;
  removeFolder(id: string): Promise<void>;
  remove(id: string): Promise<void>;
}
