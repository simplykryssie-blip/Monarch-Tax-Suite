import { stepsOf } from "../automation/steps.ts";
import type { Condition, Step, Workflow } from "../automation/types.ts";
import { parseTags, TAG_LENGTH } from "../leads/tags.ts";

// Every tag in use, how many people carry it, and the changes that can be made to a tag everywhere at once. Pure.

export type TagCount = { tag: string; clients: number; leads: number };

/** Each tag with how many clients and leads carry it, most used first. */
export function tagCounts(people: { clients: { tags?: string[] | null }[]; leads: { tags?: string[] | null }[] }): TagCount[] {
  const map = new Map<string, TagCount>();
  const bump = (tags: string[] | null | undefined, key: "clients" | "leads") => {
    for (const tag of parseTags(tags ?? [])) {
      const row = map.get(tag) ?? { tag, clients: 0, leads: 0 };
      row[key] += 1;
      map.set(tag, row);
    }
  };
  for (const c of people.clients) bump(c.tags, "clients");
  for (const l of people.leads) bump(l.tags, "leads");
  return [...map.values()].sort((a, b) => b.clients + b.leads - (a.clients + a.leads) || a.tag.localeCompare(b.tag));
}

/** One tag renamed in a list; if the new name is already there the two become one. */
export const renamedTags = (tags: string[], from: string, to: string): string[] => [...new Set(parseTags(tags).map((t) => (t === from ? to : t)))];
export const withoutTag = (tags: string[], tag: string): string[] => parseTags(tags).filter((t) => t !== tag);

/** The new name for a tag as it will be stored, or why it can't be used. */
export function newTagName(raw: unknown): { ok: true; tag: string } | { ok: false; message: string } {
  const [tag] = parseTags(typeof raw === "string" ? raw.split(",")[0] : "");
  if (!tag) return { ok: false, message: "Type the new name for the tag." };
  if (tag.length > TAG_LENGTH) return { ok: false, message: `A tag can be up to ${TAG_LENGTH} characters.` };
  return { ok: true, tag };
}

const branchConditions = (steps: Step[]): Condition[] => steps.flatMap((s) => (s.type === "branch" ? [...s.conditions, ...branchConditions(s.then), ...branchConditions(s.else)] : []));
const tagSteps = (steps: Step[]): { tag: string }[] => steps.flatMap((s) => (s.type === "branch" ? [...tagSteps(s.then), ...tagSteps(s.else)] : s.type === "add_tag" || s.type === "remove_tag" ? [s] : []));

/** The workflows (not archived) that add or remove this tag, or start or branch on it. Renaming or deleting the tag would leave them pointing at nothing. */
export function workflowsUsingTag(tag: string, workflows: Workflow[]): Workflow[] {
  const same = (v: string) => parseTags(v)[0] === tag;
  const mentions = (c: Condition) => c.field === "tag" && c.value.split(",").some(same);
  return workflows.filter((w) => {
    if (w.archived_at) return false;
    const steps = stepsOf(w);
    return tagSteps(steps).some((s) => same(s.tag)) || [...w.conditions, ...branchConditions(steps)].some(mentions);
  });
}
