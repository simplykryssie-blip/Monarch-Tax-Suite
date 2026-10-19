import "server-only";
import { pipelinesRepo } from "../pipelines/server";
import { returnsStages } from "../pipelines/service.ts";

/** The stage names an office uses for returns, so the portal shows the same words the office's board does. */
export async function boardStagesFor(tenantId: string) {
  return returnsStages(await pipelinesRepo(tenantId).list().catch(() => [])).stages;
}
