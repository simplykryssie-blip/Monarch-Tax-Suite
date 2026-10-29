import type { Contact } from "./combine.ts";

export type BulkOp = "assign" | "convert" | "tag_add" | "tag_remove" | "set_status";
export const BULK_MAX = 200;

export type BulkPlan = { targets: Contact[]; skipped: { name: string; reason: string }[] };

/** Who a bulk action applies to. A store customer on their own has no assignee or tags here; only a lead who is not yet a client can be converted. */
export function planBulk(contacts: Contact[], keys: string[], op: BulkOp, leadStatus: (leadId: string) => string | null = () => null): BulkPlan {
  const byKey = new Map(contacts.map((c) => [c.key, c]));
  const targets: Contact[] = [];
  const skipped: BulkPlan["skipped"] = [];
  for (const key of [...new Set(keys)].slice(0, BULK_MAX)) {
    const c = byKey.get(key);
    if (!c) continue;
    const hasRecord = Boolean(c.refs.clientId || c.refs.leadId);
    if (op === "convert") {
      if (c.refs.clientId) skipped.push({ name: c.name, reason: "already a client" });
      else if (!c.refs.leadId) skipped.push({ name: c.name, reason: "not a lead" });
      else if (leadStatus(c.refs.leadId) === "converted") skipped.push({ name: c.name, reason: "already converted" });
      else targets.push(c);
    } else if (op === "set_status") {
      if (!c.refs.leadId) skipped.push({ name: c.name, reason: "not a lead" });
      else if (leadStatus(c.refs.leadId) === "converted") skipped.push({ name: c.name, reason: "already converted to a client" });
      else targets.push(c);
    } else if (!hasRecord) skipped.push({ name: c.name, reason: "a store customer (nothing to change here)" });
    else targets.push(c);
  }
  return { targets, skipped };
}

/** The tags after adding or removing one tag. */
export function changeTags(tags: string[], op: "tag_add" | "tag_remove", tag: string): string[] {
  return op === "tag_add" ? (tags.includes(tag) ? tags : [...tags, tag]) : tags.filter((t) => t !== tag);
}
