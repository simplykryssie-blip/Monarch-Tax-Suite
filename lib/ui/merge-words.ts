// Merge tags as people read them. A message is stored with {{first_name}}; a person sees and writes [First name]. These two
// functions convert between the two for any composer, given that composer's own list of tags.

export type MergeWordList = { key: string; label: string }[];

/** A stored message as a person reads it: {{first_name}} shown as [First name]. Unknown tags are left as they are. */
export function toFriendlyWith(words: MergeWordList, template: string): string {
  const label = new Map(words.map((w) => [w.key, w.label]));
  return template.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (all, k: string) => (label.has(k) ? `[${label.get(k)}]` : all));
}

/** What a person wrote, back to the stored form: [First name] becomes {{first_name}}. Other bracketed text (such as a link's words) is left alone. */
export function fromFriendlyWith(words: MergeWordList, text: string): string {
  const key = new Map(words.map((w) => [w.label.toLowerCase(), w.key]));
  return text.replace(/\[([^\[\]]{1,40})\]/g, (all, w: string) => { const k = key.get(w.trim().toLowerCase()); return k ? `{{${k}}}` : all; });
}
