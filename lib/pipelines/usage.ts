import { stepsOf } from "../automation/steps.ts";
import type { Condition, Step, Workflow } from "../automation/types.ts";
import type { Pipeline } from "./types.ts";

// Where a pipeline is used by automation: a "Move to a stage" step that points at it, or a condition that tests one of its
// stages or the pipeline itself. Used to warn before the pipeline is deleted or archived, so nothing stops working unseen.

const conditionsOf = (steps: Step[]): Condition[] => steps.flatMap((s) => (s.type === "branch" ? [...s.conditions, ...conditionsOf(s.then), ...conditionsOf(s.else)] : []));
const movesOf = (steps: Step[]): { pipeline_id: string }[] => steps.flatMap((s) => (s.type === "branch" ? [...movesOf(s.then), ...movesOf(s.else)] : s.type === "move_stage" ? [s] : []));

/** The workflows (not archived) that use this pipeline. */
export function workflowsUsing(pipeline: Pick<Pipeline, "id" | "kind" | "stages">, workflows: Workflow[]): Workflow[] {
  const stageIds = new Set(pipeline.stages.map((s) => s.id));
  const mentions = (c: Condition) => (c.field === "pipeline_id" && c.value.split(",").map((v) => v.trim()).includes(pipeline.id)) || (c.field === "stage_id" && c.value.split(",").map((v) => v.trim()).some((v) => stageIds.has(v)));
  return workflows.filter((w) => {
    if (w.archived_at) return false;
    const steps = stepsOf(w);
    if (movesOf(steps).some((m) => m.pipeline_id === pipeline.id)) return true;
    if (![...w.conditions, ...conditionsOf(steps)].some(mentions)) return false;
    // A stage condition belongs to a pipeline only on the trigger that carries it: return stages for the tax-return pipeline, work stages for others.
    return w.trigger_event === (pipeline.kind === "returns" ? "return.stage_changed" : "work.stage_changed") || w.conditions.concat(conditionsOf(steps)).some((c) => c.field === "pipeline_id" && c.value.includes(pipeline.id));
  });
}
