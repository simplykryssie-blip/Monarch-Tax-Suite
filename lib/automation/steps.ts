import type { Action, Condition, Step, WaitStep, Workflow } from "./types.ts";

// A workflow is a list of steps; a step is an action, a wait, or an if/else branch holding more steps. The engine runs a
// flattened form of it (a "program" with jumps), so a run that waits or retries can carry on from a single number.

export const MAX_STEPS = 25;
export const MAX_BRANCH_DEPTH = 3;
export const WAIT_LIMITS = { minutes: 1440, hours: 720, days: 365 } as const;

export type Instr =
  | { op: "act"; action: Action; path: string }
  | { op: "wait"; wait: WaitStep; path: string }
  /** If the conditions hold, carry on with the next instruction; otherwise go to `elseAt`. */
  | { op: "branch"; conditions: Condition[]; elseAt: number; path: string }
  | { op: "jump"; to: number };

/** The steps of a workflow: its step tree, or (for one made before branches and waits) its flat action list. */
export const stepsOf = (wf: Pick<Workflow, "steps" | "actions">): Step[] => wf.steps ?? wf.actions;

/** Every step, nested ones included. */
export function countSteps(steps: Step[]): number {
  return steps.reduce((n, s) => n + 1 + (s.type === "branch" ? countSteps(s.then) + countSteps(s.else) : 0), 0);
}

/** How many branches deep the steps go (no branches: 0). */
export function branchDepth(steps: Step[]): number {
  return steps.reduce((d, s) => Math.max(d, s.type === "branch" ? 1 + Math.max(branchDepth(s.then), branchDepth(s.else)) : 0), 0);
}

/** The action steps in order, wherever they sit. Kept on the workflow as `actions` so "is this template in use" still works. */
export function flattenActions(steps: Step[]): Action[] {
  return steps.flatMap((s) => (s.type === "branch" ? [...flattenActions(s.then), ...flattenActions(s.else)] : s.type === "wait" ? [] : [s]));
}

/** Step labels people see: "1", "2", then "3a.1" for the first step in branch 3's Yes list and "3b.1" for its No list. */
export function compile(steps: Step[]): Instr[] {
  const out: Instr[] = [];
  const walk = (list: Step[], prefix: string) => {
    list.forEach((s, i) => {
      const path = prefix ? `${prefix}.${i + 1}` : String(i + 1);
      if (s.type === "wait") out.push({ op: "wait", wait: s, path });
      else if (s.type === "branch") {
        const branch: Instr & { op: "branch" } = { op: "branch", conditions: s.conditions, elseAt: -1, path };
        out.push(branch);
        walk(s.then, `${path}a`);
        const jump: Instr & { op: "jump" } = { op: "jump", to: -1 };
        out.push(jump);
        branch.elseAt = out.length;
        walk(s.else, `${path}b`);
        jump.to = out.length;
      } else out.push({ op: "act", action: s, path });
    });
  };
  walk(steps, "");
  return out;
}

/** A short line for a wait: "2 business days", "30 minutes". */
export const waitText = (w: WaitStep) => `${w.amount} ${w.mode === "business" && w.unit !== "minutes" ? "business " : ""}${w.amount === 1 ? w.unit.slice(0, -1) : w.unit}`;
