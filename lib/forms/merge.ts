import { MERGE_FIELDS } from "../documents/fields.ts";
import type { FormDefinition } from "./definition.ts";

// Client and firm details a form can show: inserted from a drop-down in the builder as {{client_name}} and filled in when
// the form is opened from a personal link. A fixed list, so a typo can never reach a client. No Social Security numbers.

export const FORM_MERGE_KEYS = [
  "client_name", "client_first_name", "client_email", "client_phone", "client_address",
  "firm_name", "firm_legal_name", "firm_email", "firm_phone", "firm_address", "firm_ptin",
  "today", "current_year",
] as const;
export type FormMergeKey = (typeof FORM_MERGE_KEYS)[number];
/** What the drop-down shows for each. */
export const FORM_MERGE_LABELS: Record<FormMergeKey, string> = Object.fromEntries(FORM_MERGE_KEYS.map((k) => [k, MERGE_FIELDS[k].label])) as Record<FormMergeKey, string>;

const TOKEN = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g;
const allowed = new Set<string>(FORM_MERGE_KEYS);

/** The names used between double braces in a piece of text that are not in the list. */
export function unknownTokens(text: string): string[] {
  return [...new Set([...text.matchAll(TOKEN)].map((m) => m[1]).filter((k) => !allowed.has(k)))];
}

/** Fills the details in. A detail with no value (a general link has no client) becomes empty. */
export function fillTokens(text: string, values: Record<string, string>): string {
  return text.replace(TOKEN, (_, k: string) => (allowed.has(k) ? values[k] ?? "" : ""));
}

/** Every piece of text in a form where details can be used, with where it is, for checking. */
export function eachText(def: FormDefinition, visit: (text: string, target: string) => void): void {
  for (const p of def.pages) {
    visit(p.title, p.id);
    for (const s of p.sections) {
      visit(s.title, s.id);
      if (s.description) visit(s.description, s.id);
      for (const f of s.fields) {
        for (const t of [f.label, f.help, f.placeholder, f.text, f.defaultValue]) if (t) visit(t, f.id);
      }
    }
  }
}

/** The form as one person sees it: every detail filled in. The saved form is never changed. */
export function mergeDefinition(def: FormDefinition, values: Record<string, string>): FormDefinition {
  const fill = (t: string | undefined) => (t ? fillTokens(t, values) : t);
  return {
    ...def,
    pages: def.pages.map((p) => ({
      ...p, title: fillTokens(p.title, values),
      sections: p.sections.map((s) => ({
        ...s, title: fillTokens(s.title, values), ...(s.description ? { description: fillTokens(s.description, values) } : {}),
        fields: s.fields.map((f) => ({ ...f, label: fillTokens(f.label, values), help: fill(f.help), placeholder: fill(f.placeholder), text: fill(f.text), defaultValue: fill(f.defaultValue) })),
      })),
    })),
  };
}

/** The details a form may show, for one client (or none) and the firm. */
export function formMergeValues(input: {
  profile: { display_name: string; legal_name: string; email: string | null; phone: string | null; address: string | null; ptin?: string | null; time_zone: string } | null;
  client: { full_name: string; email: string | null; phone: string | null; address: string | null } | null;
  now: Date;
}): Record<string, string> {
  const tz = input.profile?.time_zone ?? "America/New_York";
  const name = input.client?.full_name.trim() ?? "";
  const v: Record<string, string> = {
    today: new Intl.DateTimeFormat("en-US", { timeZone: tz, dateStyle: "long" }).format(input.now),
    current_year: new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric" }).format(input.now),
    firm_name: input.profile?.display_name ?? "", firm_legal_name: input.profile?.legal_name ?? "", firm_email: input.profile?.email ?? "",
    firm_phone: input.profile?.phone ?? "", firm_address: input.profile?.address ?? "", firm_ptin: input.profile?.ptin ?? "",
    client_name: name, client_first_name: name.split(/\s+/)[0] ?? "", client_email: input.client?.email ?? "", client_phone: input.client?.phone ?? "", client_address: input.client?.address ?? "",
  };
  return v;
}
