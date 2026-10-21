"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { DESTINATIONS, type Destination } from "@/lib/imports/contacts.ts";
import { adminTarget, prepTarget } from "@/lib/imports/server";
import { KINDS, runImport, type ImportKind, type ImportSummary } from "@/lib/imports/service.ts";
import { isArea, requirePrep } from "@/lib/prep/server";
import type { Section } from "@/lib/tier.ts";
import { requireSection } from "@/lib/tier-server";

// Importing people, notes and messages. One action for every place it is offered: the PTIN workspace and the office area
// (clients only) and the main account's admin area (clients, leads, store customers or firms, as its tier allows). Each
// call re-checks who is signed in and what they may reach, and acts only on their own account.

export type ImportState = undefined | { error: string } | ImportSummary;

const str = (form: FormData, k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string) : "");
/** The part of the app each destination belongs to, so a tier that doesn't have it can't import into it. */
const SECTION: Record<Destination, Section> = { clients: "workspace", leads: "leads", customers: "store", firms: "bureau" };

const failure = (e: unknown) => {
  if (e instanceof ValidationError) return e.message;
  console.error(`import failed: ${sanitizeError(e, 200)}`);
  return "That did not work. Nothing was changed. Please try again.";
};

/** First call: shows what the file would do. With "confirm": does it. */
export async function importAction(_prev: ImportState, form: FormData): Promise<ImportState> {
  const scope = str(form, "scope");
  const kind = str(form, "kind") as ImportKind;
  const destination = (scope === "admin" ? str(form, "destination") : "clients") as Destination;
  if (!(KINDS as string[]).includes(kind) || !(DESTINATIONS as string[]).includes(destination)) return { error: "Choose what to import and where." };
  let revalidate = "/";
  try {
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV file to import." };
    let target;
    let record: (detail: Record<string, unknown>) => Promise<void>;
    if (scope === "admin") {
      const admin = await requireAdmin();
      await requireSection(SECTION[destination]);
      target = adminTarget(destination, admin);
      record = async () => undefined;
    } else if (isArea(scope)) {
      const ctx = await requirePrep(scope, "clients.intake");
      target = prepTarget(ctx);
      revalidate = ctx.base;
      // The history records how many, never who.
      record = (detail) => ctx.deps.audit({ actor_id: ctx.userId, action: "import_run", subject_type: "client", subject_id: null, detail });
    } else {
      redirect("/login");
    }
    const summary = await runImport(target, { kind, csv: await file.text(), tag: str(form, "tag"), confirm: form.get("confirm") === "1" }, record);
    if (summary.done) revalidatePath(revalidate, "layout");
    return summary;
  } catch (e) {
    unstable_rethrow(e);
    return { error: failure(e) };
  }
}
