import Link from "next/link";
import { SetupRequiredError } from "@/lib/commerce/supabase-repo.ts";

export function money(cents: number | null, currency = "usd") {
  if (cents === null) return "Not set";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
}

export function when(iso: string | null) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Chicago" }).format(new Date(iso));
}

export const label = (value: string | null | undefined) => (value ? value.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "—");

export function Badge({ value }: { value: string }) {
  return <span className={"monarch-badge " + value.replace(/_/g, "-")}>{label(value)}</span>;
}

export function PageTitle({ title, children, back }: { title: string; children?: React.ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="monarch-page-title">
      {back && (
        <Link className="monarch-back" href={back.href}>
          ← {back.label}
        </Link>
      )}
      <div className="monarch-eyebrow">MONARCH TAX SUITE / ADMINISTRATION</div>
      <h1>{title}</h1>
      {children && <p>{children}</p>}
    </div>
  );
}

/** Renders ?notice= / ?error= messages set by server actions after a redirect. */
export function Flash({ notice, error }: { notice?: string; error?: string }) {
  if (error) return <div className="monarch-alert is-error" role="alert">{error}</div>;
  if (notice) return <div className="monarch-alert" role="status">{notice}</div>;
  return null;
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="monarch-empty">
        {children}
      </td>
    </tr>
  );
}

export function SetupRequired({ message }: { message: string }) {
  return (
    <div className="monarch-notice">
      <b>DATABASE SETUP REQUIRED</b> The Monarch commerce tables are not available yet. Apply
      <code> supabase/migrations/20261009120000_monarch_commerce_licensing.sql </code>
      to the Monarch Supabase project, then reload. <small>({message})</small>
    </div>
  );
}

/** Loads admin data, turning a missing-migration error into a setup notice instead of a crash. */
export async function load<T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (error instanceof SetupRequiredError) return { ok: false, message: error.message };
    throw error;
  }
}
