import { ValidationError } from "../commerce/validation.ts";
import type { Pipeline, PipelineKind, PipelinesRepo, Stage } from "./types.ts";

export const MIN_STAGES = 2;
export const MAX_STAGES = 15;
export const STAGE_COLORS = ["#64748b", "#2563eb", "#7c3aed", "#d97706", "#059669", "#dc2626", "#0891b2", "#be185d"] as const;

/** The stages a tax return moves through, until the office builds its own. */
export const DEFAULT_RETURN_STAGES: Stage[] = [
  { id: "intake", name: "Intake", color: "#64748b", done: false },
  { id: "documents", name: "Documents received", color: "#2563eb", done: false },
  { id: "preparing", name: "Preparing", color: "#7c3aed", done: false },
  { id: "review", name: "Review", color: "#d97706", done: false },
  { id: "signature", name: "Awaiting client signature", color: "#0891b2", done: false },
  { id: "efiled", name: "E-filed", color: "#2563eb", done: false },
  { id: "accepted", name: "Accepted", color: "#059669", done: false },
  { id: "complete", name: "Complete", color: "#059669", done: true },
];

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "stage";

/** Stages as sent from the builder, checked: 2 to 15, named, a hex colour, unique ids, at least one that finishes the work. */
export function checkStages(raw: unknown): Stage[] {
  let list: unknown = raw;
  if (typeof raw === "string") {
    try { list = JSON.parse(raw); } catch { throw new ValidationError("The stages could not be read. Reload the page and try again."); }
  }
  if (!Array.isArray(list)) throw new ValidationError("A pipeline needs stages.");
  if (list.length < MIN_STAGES) throw new ValidationError(`A pipeline needs at least ${MIN_STAGES} stages.`);
  if (list.length > MAX_STAGES) throw new ValidationError(`A pipeline can have up to ${MAX_STAGES} stages.`);
  const used = new Set<string>();
  const names = new Set<string>();
  const stages = list.map((item, i): Stage => {
    const r = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const name = clean(r.name, 40);
    if (!name) throw new ValidationError(`Stage ${i + 1} needs a name.`);
    if (names.has(name.toLowerCase())) throw new ValidationError(`Two stages are named "${name}". Give each its own name.`);
    names.add(name.toLowerCase());
    let id = typeof r.id === "string" && /^[a-z0-9-]{1,30}$/.test(r.id) ? r.id : slug(name);
    for (let n = 2; used.has(id); n++) id = `${slug(name).slice(0, 26)}-${n}`;
    used.add(id);
    const color = typeof r.color === "string" && /^#[0-9a-fA-F]{6}$/.test(r.color) ? r.color.toLowerCase() : STAGE_COLORS[0];
    return { id, name, color, done: r.done === true };
  });
  if (!stages.some((s) => s.done)) throw new ValidationError("Mark at least one stage as the one where work is finished.");
  return stages;
}

const checkName = (raw: unknown) => {
  const name = clean(raw, 80);
  if (name.length < 2) throw new ValidationError("Give the pipeline a name.");
  return name;
};

export async function createPipeline(repo: PipelinesRepo, input: { name: unknown; kind?: unknown; stages: unknown }, actorId: string): Promise<Pipeline> {
  const kind: PipelineKind = input.kind === "returns" ? "returns" : "custom";
  const existing = await repo.list();
  const isDefault = kind === "returns" && !existing.some((p) => p.kind === "returns" && !p.archived_at);
  return repo.insert({ name: checkName(input.name), kind, stages: checkStages(input.stages), is_default: isDefault, created_by: actorId });
}

export async function savePipeline(repo: PipelinesRepo, id: string, input: { name: unknown; stages: unknown }): Promise<Pipeline> {
  const p = await repo.get(id);
  if (!p || p.archived_at) throw new ValidationError("That pipeline wasn't found.");
  return repo.update(id, { name: checkName(input.name), stages: checkStages(input.stages) });
}

/** Makes this the returns pipeline the My Work board uses. */
export async function makeDefault(repo: PipelinesRepo, id: string): Promise<Pipeline> {
  const p = await repo.get(id);
  if (!p || p.archived_at) throw new ValidationError("That pipeline wasn't found.");
  if (p.kind !== "returns") throw new ValidationError("Only a tax-return pipeline can run the My Work board.");
  for (const other of await repo.list()) if (other.id !== id && other.kind === "returns" && other.is_default) await repo.update(other.id, { is_default: false });
  return repo.update(id, { is_default: true });
}

export async function archivePipeline(repo: PipelinesRepo, id: string, archive: boolean): Promise<Pipeline> {
  const p = await repo.get(id);
  if (!p) throw new ValidationError("That pipeline wasn't found.");
  if (archive && p.is_default) throw new ValidationError("This pipeline runs the My Work board. Make another tax-return pipeline the default first.");
  return repo.update(id, { archived_at: archive ? new Date().toISOString() : null });
}

/** The stages the My Work board uses: the default returns pipeline, or the built-in set when there isn't one. */
export function returnsStages(pipelines: Pipeline[]): { pipeline: Pipeline | null; stages: Stage[] } {
  const p = pipelines.find((x) => x.kind === "returns" && x.is_default && !x.archived_at) ?? null;
  return { pipeline: p, stages: p?.stages ?? DEFAULT_RETURN_STAGES };
}
