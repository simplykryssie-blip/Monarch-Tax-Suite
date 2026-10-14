import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOffice } from "@/lib/office/server";
import { can } from "@/lib/office/permissions.ts";
import { complianceDeps, ctxFor } from "@/lib/compliance/server";
import type { Alert } from "@/lib/compliance/rules.ts";

// Pieces shared by the Compliance Center pages.

/** The signed-in member, their office, and the compliance wiring. Without `key`, sends them home. */
export async function compliancePage(key: string) {
  const office = await requireOffice();
  const ctx = ctxFor(office);
  if (!can(ctx.role, ctx.permissions, key)) redirect("/office/compliance?error=" + encodeURIComponent("You don't have access to that part of the Compliance Center. Ask your ERO."));
  return { office, ctx, deps: complianceDeps(office.tenantId), may: (k: string) => can(ctx.role, ctx.permissions, k) };
}

const TABS: { key: string; label: string; href: string }[] = [
  { key: "compliance.home", label: "Overview", href: "/office/compliance" },
  { key: "compliance.home", label: "WISP", href: "/office/compliance/wisp" },
  { key: "compliance.8879", label: "Form 8879", href: "/office/compliance/8879" },
  { key: "compliance.home", label: "PTIN", href: "/office/compliance/ptin" },
  { key: "compliance.home", label: "Incidents", href: "/office/compliance/incidents" },
  { key: "compliance.vault", label: "Vault", href: "/office/compliance/vault" },
  { key: "compliance.manage", label: "Checklist", href: "/office/compliance/items" },
  { key: "compliance.manage", label: "Settings", href: "/office/compliance/settings" },
  { key: "compliance.manage", label: "History", href: "/office/compliance/history" },
];

export function ComplianceTabs({ may, active }: { may: (k: string) => boolean; active: string }) {
  return (
    <nav className="fees-tabs" aria-label="Compliance Center">
      {TABS.filter((t) => may(t.key)).map((t) => <Link key={t.href} href={t.href} className={t.href === active ? "is-active" : undefined} aria-current={t.href === active ? "page" : undefined}>{t.label}</Link>)}
    </nav>
  );
}

export function Alerts({ alerts }: { alerts: Alert[] }) {
  if (!alerts.length) return <p className="monarch-alert">Nothing needs attention right now.</p>;
  return (
    <ul className="compliance-alerts">
      {alerts.map((a) => <li key={a.title} className={`is-${a.tone}`}><Link href={a.href}><b>{a.title}</b><span>{a.detail}</span></Link></li>)}
    </ul>
  );
}

/** "Required by IRS" / "Required by FTC": the rule applies; the office can still decide. */
export function Required({ by }: { by: "IRS" | "FTC" }) {
  return <span className="compliance-required">Required by {by}</span>;
}

export function SetupNotice({ message }: { message: string }) {
  return <div className="monarch-notice"><b>DATABASE SETUP REQUIRED</b> The Compliance Center needs its tables. Apply <code>supabase/migrations/20261022090000_compliance.sql</code>, then reload. <small>({message})</small></div>;
}

/** Turns a missing-table error into a setup notice instead of a crash. */
export async function loadOr<T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    if (/relation|schema cache|does not exist/i.test(m)) return { ok: false, message: m.slice(0, 200) };
    throw e;
  }
}

export const day = (d: string | null) => (d ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`)) : "—");
export const stamp = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" }).format(new Date(iso)) : "—");
