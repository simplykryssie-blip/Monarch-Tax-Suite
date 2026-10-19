import type { Condition, Field, FormDefinition, Page } from "./definition.ts";

// Show/hide and skip logic. The browser and the server run this same code: the server decides on its own which
// fields the respondent saw, drops answers to hidden or skipped fields, and requires only visible fields.

/** An answer as the browser holds it. */
export type RawAnswer = string | string[] | Record<string, string> | { id: string; name: string }[] | null | undefined;
export type RawAnswers = Record<string, RawAnswer>;

export function isAnswered(v: RawAnswer): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (Array.isArray(v)) return v.length > 0;
  return Object.values(v).some((x) => typeof x === "string" && x.trim() !== "");
}

function test(c: Condition, field: Field | undefined, answers: RawAnswers, visible: Set<string>): boolean {
  if (!field) return false;
  // A hidden field counts as unanswered.
  const v = visible.has(field.id) ? answers[field.key] : undefined;
  if (c.op === "answered") return isAnswered(v);
  if (c.op === "empty") return !isAnswered(v);
  const want = (c.value ?? "").trim();
  if (Array.isArray(v)) {
    const list = v.map((x) => (typeof x === "string" ? x : x.name));
    if (c.op === "contains" || c.op === "equals") return list.includes(want);
    if (c.op === "not_equals") return !list.includes(want);
    return false;
  }
  const got = typeof v === "string" ? v.trim() : "";
  switch (c.op) {
    case "equals":
      return got.toLowerCase() === want.toLowerCase();
    case "not_equals":
      return got.toLowerCase() !== want.toLowerCase();
    case "contains":
      return want !== "" && got.toLowerCase().includes(want.toLowerCase());
    case "gt":
    case "lt": {
      if (!got) return false;
      if (field.type === "date") return c.op === "gt" ? got > want : got < want;
      const a = Number(got);
      const b = Number(want);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
      return c.op === "gt" ? a > b : a < b;
    }
  }
  return false;
}

const matches = (match: "all" | "any", conditions: Condition[], fields: Map<string, Field>, answers: RawAnswers, visible: Set<string>) =>
  match === "any" ? conditions.some((c) => test(c, fields.get(c.field), answers, visible)) : conditions.every((c) => test(c, fields.get(c.field), answers, visible));

export type LogicState = {
  /** Page ids the respondent goes through, in order. */
  path: string[];
  /** Field ids that are shown (on a page in the path, and not hidden by a rule). */
  visible: Set<string>;
};

/**
 * Works through the form in order. Rules only test earlier fields, so one pass decides everything. A section hidden
 * by a rule hides its fields; a page not on the path hides all of its fields.
 */
export function evaluate(def: FormDefinition, answers: RawAnswers): LogicState {
  const fields = new Map(def.pages.flatMap((p) => p.sections.flatMap((s) => s.fields)).map((f) => [f.id, f]));
  const rulesFor = new Map<string, typeof def.rules>();
  for (const r of def.rules) rulesFor.set(r.target, [...(rulesFor.get(r.target) ?? []), r]);
  const visible = new Set<string>();
  const shown = (id: string) => (rulesFor.get(id) ?? []).every((r) => {
    const hit = matches(r.match, r.conditions, fields, answers, visible);
    return r.action === "show" ? hit : !hit;
  });
  const path: string[] = [];
  const index = new Map(def.pages.map((p, i) => [p.id, i]));
  let i = 0;
  const guard = def.pages.length + 1;
  for (let steps = 0; i < def.pages.length && steps < guard; steps++) {
    const page: Page = def.pages[i];
    path.push(page.id);
    for (const s of page.sections) {
      if (!shown(s.id)) continue;
      for (const f of s.fields) if (shown(f.id)) visible.add(f.id);
    }
    const skip = page.skips.find((k) => matches(k.match, k.conditions, fields, answers, visible));
    if (!skip) i += 1;
    else if (skip.goto === "end") break;
    else {
      const to = index.get(skip.goto);
      // Skips only go forward (checked on save); anything else just continues.
      i = to !== undefined && to > i ? to : i + 1;
    }
  }
  return { path, visible };
}

/** The next and previous page for the respondent on `pageId`, given their answers so far. */
export function neighbours(def: FormDefinition, answers: RawAnswers, pageId: string): { prev: string | null; next: string | null; last: boolean } {
  const { path } = evaluate(def, answers);
  const at = path.indexOf(pageId);
  if (at < 0) return { prev: path[path.length - 1] ?? null, next: null, last: true };
  return { prev: at > 0 ? path[at - 1] : null, next: at + 1 < path.length ? path[at + 1] : null, last: at === path.length - 1 };
}
