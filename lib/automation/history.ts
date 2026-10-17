import type { ActionResult, AutomationEvent, Execution } from "./types.ts";

// The run history: one row per step of every run, with who it was for, when, and whether it completed or errored.

export type HistoryRow = {
  key: string;
  executionId: string;
  when: string;
  who: string;
  workflow: string;
  step: string;
  result: "completed" | "error" | "skipped" | "waiting";
  detail: string;
  /** First row of its run (the when/who/workflow cells span the run's steps). */
  first: boolean;
  span: number;
  canRetry: boolean;
  isTest: boolean;
};

const STEP_NAME: Record<string, string> = { send_email: "Send email", send_document: "Send a document", request_signature: "Request a signature", record_note: "Record a note", wait: "Wait", branch: "If / else", create_task: "Create a task", add_tag: "Add a tag", remove_tag: "Remove a tag", update_contact: "Update the lead", send_text: "Send a text" };
export const stepName = (type: string) => STEP_NAME[type] ?? type.replace(/_/g, " ");

export function historyRows(input: {
  executions: Execution[];
  workflows: Map<string, string>;
  events: Map<string, AutomationEvent>;
  people: Map<string, string>;
  /** Names of the steps for a run that has not logged them yet: [type] per index. */
  plannedSteps: Map<string, string[]>;
}): HistoryRow[] {
  const rows: HistoryRow[] = [];
  for (const e of input.executions) {
    const ev = input.events.get(e.event_id);
    const person = ev?.customer_id ? input.people.get(ev.customer_id) : undefined;
    const who = ev?.data.test_client === true ? `${person ?? "A client"} (test)` : e.is_test ? "Test run (sample data)" : person ?? (ev ? "System" : "—");
    const workflow = input.workflows.get(e.workflow_id) ?? "Removed workflow";
    const waiting = e.status === "queued" || e.status === "retrying" || e.status === "running" || e.status === "waiting";
    const failedHere = e.status === "failed";
    const log: ActionResult[] = [...e.action_log].sort((a, b) => a.index - b.index);
    const lines: { step: string; result: HistoryRow["result"]; detail: string }[] = log.map((l) => ({
      step: `${l.path ?? l.index + 1}. ${stepName(l.type)}`,
      result: l.type === "wait" && l.status === "ok" && e.status === "waiting" && l.index === (e.pc ?? 0) - 1 ? "waiting" : l.status === "ok" ? "completed" : l.status === "failed" ? "error" : "skipped",
      detail: l.detail,
    }));
    if (!lines.length) {
      lines.push({ step: "—", result: failedHere ? "error" : waiting ? "waiting" : e.status === "skipped" ? "skipped" : "completed", detail: e.error ?? (waiting ? "Waiting to run or retry." : "") });
    } else if (waiting) {
      const planned = input.plannedSteps.get(e.workflow_id) ?? [];
      for (let i = log.length; i < planned.length; i++) lines.push({ step: `${i + 1}. ${stepName(planned[i])}`, result: "waiting", detail: e.next_attempt_at ? `Next try ${e.next_attempt_at.slice(0, 16).replace("T", " ")} UTC.` : "Waiting." });
    }
    lines.forEach((l, i) => rows.push({
      key: `${e.id}:${i}`, executionId: e.id, when: e.created_at, who, workflow, step: l.step, result: l.result, detail: l.detail,
      first: i === 0, span: lines.length, canRetry: (e.status === "failed" || e.status === "skipped") && i === 0, isTest: e.is_test,
    }));
  }
  return rows;
}
