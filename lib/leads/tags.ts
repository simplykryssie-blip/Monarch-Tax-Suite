// Lead tags: free-form labels the account holder makes up.

export const TAG_MAX = 12;
export const TAG_LENGTH = 40;

/** Tags as people type them: one string split on commas or new lines, or a list. Lower case, tidy spaces, no repeats. */
export function parseTags(raw: unknown): string[] {
  const parts = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,\n]/) : [];
  const out: string[] = [];
  for (const p of parts) {
    if (typeof p !== "string") continue;
    const tag = p.normalize("NFKC").replace(/[^\p{L}\p{N} _&/.+-]/gu, "").replace(/\s+/g, " ").trim().toLowerCase();
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}
