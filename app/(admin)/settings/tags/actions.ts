"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { leadsDeps } from "@/lib/leads/server";
import { parseTags } from "@/lib/leads/tags.ts";
import { deleteTag, renameTag, type TagDeps } from "@/lib/tags/service.ts";
import { workspaceRepo } from "@/lib/workspace/server";

// Rename, merge or delete a tag for everyone who has it. Every action re-checks administrator access.

const PAGE = "/settings/tags";
const withParam = (key: "notice" | "error", message: string) => `${PAGE}?${key}=${encodeURIComponent(message)}`;
const deps = (): TagDeps => ({ clients: workspaceRepo(), leads: leadsDeps().repo });
const tagOf = (form: FormData) => {
  const [tag] = parseTags(String(form.get("tag") ?? ""));
  if (!tag) throw new ValidationError("That tag wasn't found.");
  return tag;
};
const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;

async function act(fn: () => Promise<string>) {
  await requireAdmin();
  let target: string;
  try {
    target = withParam("notice", await fn());
  } catch (e) {
    if (e instanceof ValidationError) target = withParam("error", e.message);
    else {
      console.error(`tags action failed: ${sanitizeError(e, 200)}`);
      target = withParam("error", "That did not work. Nothing was changed. Please try again.");
    }
  }
  revalidatePath("/contacts", "layout");
  revalidatePath("/settings/tags");
  redirect(target);
}

export async function renameTagAction(form: FormData) {
  await act(async () => {
    const r = await renameTag(deps(), tagOf(form), form.get("to"));
    return r.merged ? `Merged into “${r.to}” for ${people(r.people)}.` : `Renamed to “${r.to}” for ${people(r.people)}.`;
  });
}

export async function deleteTagAction(form: FormData) {
  await act(async () => {
    const tag = tagOf(form);
    const r = await deleteTag(deps(), tag);
    return `“${tag}” was taken off ${people(r.people)}.`;
  });
}
