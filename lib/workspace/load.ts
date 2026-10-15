import "server-only";
import { pipelinesRepo } from "../pipelines/server";
import { returnsStages } from "../pipelines/service.ts";
import { workspaceRepo } from "./server";

/** A page's data, or the setup message when the workspace tables aren't installed yet. */
export async function workspaceLoad<T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    if (/relation|schema cache|does not exist/i.test(m)) return { ok: false, message: m.slice(0, 200) };
    throw e;
  }
}

export const todayIso = () => new Date().toISOString().slice(0, 10);

/** The stages the My Work board uses (the default tax-return pipeline, or the built-in set). */
export async function boardStages() {
  return returnsStages(await pipelinesRepo().list().catch(() => [])).stages;
}

export { workspaceRepo };
