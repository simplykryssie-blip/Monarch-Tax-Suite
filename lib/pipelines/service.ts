import { ValidationError } from "../commerce/validation.ts";
import type { Pipeline, PipelineFolder, PipelineKind, PipelinesRepo, Stage } from "./types.ts";

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

/** What a pipeline is for, in the office's own words. Optional. */
export function checkTypeLabel(v: unknown): string | null {
  const t = clean(v, 40);
  return t || null;
}

export function checkColor(v: unknown): string {
  return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : STAGE_COLORS[1];
}

export async function saveDetails(repo: PipelinesRepo, id: string, input: { type_label: unknown; color: unknown }): Promise<Pipeline> {
  const p = await repo.get(id);
  if (!p || p.archived_at) throw new ValidationError("That pipeline wasn't found.");
  return repo.update(id, { type_label: checkTypeLabel(input.type_label), color: checkColor(input.color) });
}

/** Publishes or unpublishes a pipeline. The one that runs the tax-return board stays published. */
export async function setPublished(repo: PipelinesRepo, id: string, published: boolean): Promise<Pipeline> {
  const p = await repo.get(id);
  if (!p || p.archived_at) throw new ValidationError("That pipeline wasn't found.");
  if (!published && p.is_default) throw new ValidationError("This pipeline runs the tax-return board, so it stays published.");
  return repo.update(id, { published });
}

/** A pipeline that is live: published and not archived. A row from before publishing existed counts as published. */
export const isLive = (p: Pipeline) => !p.archived_at && p.published !== false;

export const MAX_FOLDER_DEPTH = 4;
const folderDepth = (folders: PipelineFolder[], id: string | null): number => {
  let n = 0;
  for (let cur = id; cur; n++) cur = folders.find((f) => f.id === cur)?.parent_id ?? null;
  return n;
};

export async function createFolder(repo: PipelinesRepo, input: { name: unknown; parent_id?: unknown }, actorId: string): Promise<PipelineFolder> {
  const name = clean(input.name, 80);
  if (!name) throw new ValidationError("Give the folder a name.");
  const parent_id = typeof input.parent_id === "string" && input.parent_id ? input.parent_id : null;
  const folders = await repo.listFolders();
  if (parent_id && !folders.some((f) => f.id === parent_id)) throw new ValidationError("That folder wasn't found.");
  if (folderDepth(folders, parent_id) >= MAX_FOLDER_DEPTH) throw new ValidationError(`Folders can go ${MAX_FOLDER_DEPTH} levels deep.`);
  if (folders.some((f) => f.parent_id === parent_id && f.name.toLowerCase() === name.toLowerCase())) throw new ValidationError("A folder with that name is already here.");
  return repo.insertFolder({ name, parent_id, created_by: actorId });
}

export async function renameFolder(repo: PipelinesRepo, id: string, name: unknown): Promise<PipelineFolder> {
  const n = clean(name, 80);
  if (!n) throw new ValidationError("Give the folder a name.");
  const folders = await repo.listFolders();
  const f = folders.find((x) => x.id === id);
  if (!f) throw new ValidationError("That folder wasn't found.");
  if (folders.some((x) => x.id !== id && x.parent_id === f.parent_id && x.name.toLowerCase() === n.toLowerCase())) throw new ValidationError("A folder with that name is already here.");
  return repo.updateFolder(id, { name: n });
}

/** Deletes a folder. What was inside moves up into the folder above it; no pipeline is deleted. */
export async function deleteFolder(repo: PipelinesRepo, id: string): Promise<PipelineFolder> {
  const folders = await repo.listFolders();
  const f = folders.find((x) => x.id === id);
  if (!f) throw new ValidationError("That folder wasn't found.");
  for (const p of await repo.list()) if (p.folder_id === id) await repo.update(p.id, { folder_id: f.parent_id });
  for (const child of folders.filter((x) => x.parent_id === id)) await repo.updateFolder(child.id, { parent_id: f.parent_id });
  await repo.removeFolder(id);
  return f;
}

export async function movePipeline(repo: PipelinesRepo, id: string, folderId: unknown): Promise<Pipeline> {
  const p = await repo.get(id);
  if (!p) throw new ValidationError("That pipeline wasn't found.");
  const folder_id = typeof folderId === "string" && folderId ? folderId : null;
  if (folder_id && !(await repo.listFolders()).some((f) => f.id === folder_id)) throw new ValidationError("That folder wasn't found.");
  return repo.update(id, { folder_id });
}

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

/** A create request repeated within this long, with the same name, is the same click arriving twice. */
export const DUPLICATE_CREATE_WINDOW_MS = 60_000;

/**
 * Creates a pipeline. Creating is the only path that inserts (saving, renaming and every stage change update the
 * existing record). It is also safe to repeat: a double-clicked or re-sent create returns the pipeline the first one
 * made, and the standard-pipeline quick start never makes a second tax-return pipeline.
 */
export async function createPipeline(repo: PipelinesRepo, input: { name: unknown; kind?: unknown; stages: unknown; quickStart?: boolean; type_label?: unknown; color?: unknown; folder_id?: unknown }, actorId: string, now: () => Date = () => new Date()): Promise<Pipeline> {
  const kind: PipelineKind = input.kind === "returns" ? "returns" : "custom";
  const name = checkName(input.name);
  const stages = checkStages(input.stages);
  const existing = await repo.list();
  const active = existing.filter((p) => !p.archived_at);
  if (input.quickStart && kind === "returns") {
    const have = active.find((p) => p.kind === "returns" && p.is_default) ?? active.find((p) => p.kind === "returns");
    if (have) return have;
  }
  const again = active.find((p) => p.kind === kind && p.name.toLowerCase() === name.toLowerCase() && now().getTime() - Date.parse(p.created_at) < DUPLICATE_CREATE_WINDOW_MS);
  if (again) return again;
  const isDefault = kind === "returns" && !existing.some((p) => p.kind === "returns" && !p.archived_at);
  try {
    const folder_id = typeof input.folder_id === "string" && input.folder_id ? input.folder_id : null;
    if (folder_id && !(await repo.listFolders()).some((f) => f.id === folder_id)) throw new ValidationError("That folder wasn't found.");
    // A pipeline you build starts unpublished, so it isn't offered anywhere until you're happy with its stages.
    return await repo.insert({ name, kind, stages, is_default: isDefault, created_by: actorId, type_label: checkTypeLabel(input.type_label), color: checkColor(input.color), published: kind === "returns", folder_id });
  } catch (e) {
    // Two requests racing past the check above: the database allows one, and the other gets that one back.
    if (/duplicate key|pipelines_active_name_key/i.test(e instanceof Error ? e.message : "")) {
      const same = (await repo.list()).find((p) => !p.archived_at && p.kind === kind && p.name.toLowerCase() === name.toLowerCase());
      if (same) return same;
    }
    throw e;
  }
}

export async function savePipeline(repo: PipelinesRepo, id: string, input: { name: unknown; stages: unknown }): Promise<Pipeline> {
  const p = await repo.get(id);
  if (!p || p.archived_at) throw new ValidationError("That pipeline wasn't found.");
  try {
    return await repo.update(id, { name: checkName(input.name), stages: checkStages(input.stages) });
  } catch (e) {
    if (/duplicate key|pipelines_active_name_key/i.test(e instanceof Error ? e.message : "")) throw new ValidationError("Another pipeline already has that name. Choose a different name.");
    throw e;
  }
}

/** Makes this the returns pipeline the Returns board uses. */
export async function makeDefault(repo: PipelinesRepo, id: string): Promise<Pipeline> {
  const p = await repo.get(id);
  if (!p || p.archived_at) throw new ValidationError("That pipeline wasn't found.");
  if (p.kind !== "returns") throw new ValidationError("Only a tax-return pipeline can run the Returns board.");
  for (const other of await repo.list()) if (other.id !== id && other.kind === "returns" && other.is_default) await repo.update(other.id, { is_default: false });
  return repo.update(id, { is_default: true });
}

export async function archivePipeline(repo: PipelinesRepo, id: string, archive: boolean): Promise<Pipeline> {
  const p = await repo.get(id);
  if (!p) throw new ValidationError("That pipeline wasn't found.");
  if (archive && p.is_default) throw new ValidationError("This pipeline runs the Returns board. Make another tax-return pipeline the default first.");
  if (!archive && p.archived_at) {
    // Active pipelines of one kind have unique names, so a restore can't bring back a second "Tax returns".
    const clash = (await repo.list()).find((o) => o.id !== id && !o.archived_at && o.kind === p.kind && o.name.toLowerCase() === p.name.toLowerCase());
    if (clash) throw new ValidationError(`Another pipeline is already called "${clash.name}". Rename or archive that one first, then restore this one.`);
  }
  try {
    return await repo.update(id, { archived_at: archive ? new Date().toISOString() : null });
  } catch (e) {
    if (/duplicate key|pipelines_active_name_key/i.test(e instanceof Error ? e.message : "")) throw new ValidationError("Another pipeline already has that name. Rename or archive it first.");
    throw e;
  }
}

/**
 * Deletes a pipeline for good. Only an archived pipeline can be deleted, so it is never the one running the Returns board.
 * Returns on the board keep their stage; nothing else points at a pipeline.
 */
export async function deletePipeline(repo: PipelinesRepo, id: string): Promise<Pipeline> {
  const p = await repo.get(id);
  if (!p) throw new ValidationError("That pipeline wasn't found.");
  if (!p.archived_at) throw new ValidationError("Archive the pipeline first. Only archived pipelines can be deleted.");
  if (p.is_default) throw new ValidationError("This pipeline runs the Returns board, so it can't be deleted.");
  await repo.remove(id);
  return p;
}

/** The stages the My Work board uses: the default returns pipeline, or the built-in set when there isn't one. */
export function returnsStages(pipelines: Pipeline[]): { pipeline: Pipeline | null; stages: Stage[] } {
  const p = pipelines.find((x) => x.kind === "returns" && x.is_default && !x.archived_at) ?? null;
  return { pipeline: p, stages: p?.stages ?? DEFAULT_RETURN_STAGES };
}
