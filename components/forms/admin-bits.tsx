import Link from "next/link";
import type { FormRow } from "@/lib/forms/types.ts";
import { Badge } from "@/components/admin/ui";

// Shared pieces of the Form Builder admin pages.

export function FormTabs({ form, active, link }: { form: Pick<FormRow, "id" | "name" | "status" | "public_id" | "current_version_id">; active: "build" | "settings" | "submissions"; link?: string | null }) {
  const tabs = [
    { key: "build", label: "Build", href: `/forms/${form.id}` },
    { key: "settings", label: "Settings", href: `/forms/${form.id}/settings` },
    { key: "submissions", label: "Submissions", href: `/forms/${form.id}/submissions` },
  ] as const;
  return (
    <nav className="mf-tabs" aria-label="Form sections">
      {tabs.map((t) => <Link key={t.key} href={t.href} className={t.key === active ? "is-active" : undefined} aria-current={t.key === active ? "page" : undefined}>{t.label}</Link>)}
      <span className="mf-tabs-meta"><Badge value={form.status} />{form.current_version_id && form.status === "published" && link && <a href={link} target="_blank" rel="noreferrer">Open the public form ↗</a>}</span>
    </nav>
  );
}

/** Loads Form Builder data; a missing migration shows a setup notice instead of an error page. */
export async function formsLoad<T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    if (/relation|schema cache|does not exist|MONARCH_ENCRYPTION_KEY/i.test(m)) return { ok: false, message: m.slice(0, 200) };
    throw e;
  }
}

export function FormsSetupRequired({ message }: { message: string }) {
  return (
    <div className="monarch-notice">
      <b>SETUP REQUIRED</b> The Form Builder needs its database tables. Apply <code>supabase/migrations/20261016090000_forms.sql</code>, then reload. <small>({message})</small>
    </div>
  );
}
