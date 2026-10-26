import { ValidationError } from "../commerce/validation.ts";
import type { LeadsRepo } from "../leads/types.ts";
import { TAG_MAX } from "../leads/tags.ts";
import type { WorkspaceRepo } from "../workspace/types.ts";
import { newTagName, renamedTags, tagCounts, withoutTag, type TagCount } from "./rules.ts";

// Tags are kept on each client and each lead. These change one tag on everyone who has it. Nothing here starts a workflow:
// a tag changed this way is housekeeping, not something that happened to a person.

export type TagDeps = { clients: Pick<WorkspaceRepo, "listClients" | "updateClient">; leads: Pick<LeadsRepo, "listLeads" | "updateLead"> };
const LIMIT = 5000;

async function load(d: TagDeps) {
  const [clients, leads] = await Promise.all([d.clients.listClients({ includeArchived: true }), d.leads.listLeads({ limit: LIMIT })]);
  return { clients, leads };
}

export async function allTags(d: TagDeps): Promise<TagCount[]> {
  return tagCounts(await load(d));
}

/** Renames a tag everywhere. If the new name already exists the two tags become one. Returns how many people changed. */
export async function renameTag(d: TagDeps, from: string, rawTo: unknown): Promise<{ people: number; to: string; merged: boolean }> {
  const named = newTagName(rawTo);
  if (!named.ok) throw new ValidationError(named.message);
  const to = named.tag;
  if (to === from) throw new ValidationError("That is already its name.");
  const { clients, leads } = await load(d);
  const merged = [...clients, ...leads].some((p) => (p.tags ?? []).includes(to));
  let people = 0;
  for (const c of clients) {
    if (!(c.tags ?? []).includes(from)) continue;
    const next = renamedTags(c.tags ?? [], from, to);
    if (next.length > TAG_MAX) throw new ValidationError(`${c.full_name} would have more than ${TAG_MAX} tags.`);
    await d.clients.updateClient(c.id, { tags: next });
    people++;
  }
  for (const l of leads) {
    if (!(l.tags ?? []).includes(from)) continue;
    const next = renamedTags(l.tags ?? [], from, to);
    if (next.length > TAG_MAX) throw new ValidationError(`${l.full_name} would have more than ${TAG_MAX} tags.`);
    await d.leads.updateLead(l.id, { tags: next });
    people++;
  }
  return { people, to, merged };
}

/** Takes a tag off everyone who has it. */
export async function deleteTag(d: TagDeps, tag: string): Promise<{ people: number }> {
  const { clients, leads } = await load(d);
  let people = 0;
  for (const c of clients) if ((c.tags ?? []).includes(tag)) { await d.clients.updateClient(c.id, { tags: withoutTag(c.tags ?? [], tag) }); people++; }
  for (const l of leads) if ((l.tags ?? []).includes(tag)) { await d.leads.updateLead(l.id, { tags: withoutTag(l.tags ?? [], tag) }); people++; }
  return { people };
}
