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
  archived_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};
export type PipelineInput = Pick<Pipeline, "name" | "kind" | "stages">;

export interface PipelinesRepo {
  list(): Promise<Pipeline[]>;
  get(id: string): Promise<Pipeline | null>;
  insert(input: PipelineInput & { is_default: boolean; created_by: string | null }): Promise<Pipeline>;
  update(id: string, patch: Partial<Pick<Pipeline, "name" | "stages" | "is_default" | "archived_at">>): Promise<Pipeline>;
}
