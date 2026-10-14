"use client";

import { useId, useState } from "react";
import { parseTags, TAG_LENGTH, TAG_MAX } from "@/lib/leads/tags.ts";

/**
 * Tags on a lead: type one and press Enter or a comma. Tags you've used before are suggested, and a new word is a new
 * tag. The form submits them as one comma-separated field named `name`.
 */
export function TagInput({ name = "tags", initial = [], suggestions = [] }: { name?: string; initial?: string[]; suggestions?: string[] }) {
  const [tags, setTags] = useState<string[]>(initial);
  const [draft, setDraft] = useState("");
  const list = useId();
  const add = (raw: string) => {
    const next = parseTags([...tags, ...parseTags(raw)]).slice(0, TAG_MAX);
    setTags(next);
    setDraft("");
  };
  return (
    <div className="tag-input">
      <input type="hidden" name={name} value={tags.join(",")} />
      <ul className="tag-chips" aria-label="Tags">
        {tags.map((t) => (
          <li key={t} className="tag-chip">
            {t}
            <button type="button" aria-label={`Remove tag ${t}`} onClick={() => setTags(tags.filter((x) => x !== t))}>×</button>
          </li>
        ))}
      </ul>
      <input
        type="text"
        value={draft}
        list={list}
        maxLength={TAG_LENGTH}
        placeholder={tags.length >= TAG_MAX ? "Tag limit reached" : "Add a tag and press Enter"}
        disabled={tags.length >= TAG_MAX}
        aria-label="Add a tag"
        autoComplete="off"
        onChange={(e) => (e.target.value.includes(",") ? add(e.target.value) : setDraft(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); if (draft.trim()) add(draft); }
          else if (e.key === "Backspace" && !draft && tags.length) setTags(tags.slice(0, -1));
        }}
        onBlur={() => draft.trim() && add(draft)}
      />
      <datalist id={list}>{suggestions.filter((s) => !tags.includes(s)).map((s) => <option key={s} value={s} />)}</datalist>
    </div>
  );
}
