import Link from "next/link";
import { FlashToast } from "./flash-toast";
import { Icon } from "./icons";
import { sentence } from "@/lib/efin/text.ts";
import { SetupRequiredError } from "@/lib/commerce/supabase-repo.ts";

export function money(cents: number | null, currency = "usd") {
  if (cents === null) return "Not set";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
}

export function when(iso: string | null) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Chicago" }).format(new Date(iso));
}

export const label = (value: string | null | undefined) => (value ? sentence(value) : "—");

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
      <div className="monarch-eyebrow">VEREXA HQ / ADMINISTRATION</div>
      <h1>{title}</h1>
      {children && <p>{children}</p>}
    </div>
  );
}

/** Renders ?notice= / ?error= messages set by server actions after a redirect. */
export function Flash({ notice, error }: { notice?: string; error?: string }) {
  return <FlashToast notice={notice} error={error} />;
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="monarch-empty">
        <div className="mt-empty"><Icon name="check" size={22} /><span>{children}</span></div>
      </td>
    </tr>
  );
}

export function SetupRequired({ message, module }: { message: string; module?: "efin" }) {
  if (module === "efin") {
    return (
      <div className="monarch-notice">
        <b>DATABASE SETUP REQUIRED</b> My Service Bureau needs its database tables, which have not been installed on this database yet. Run
        <code> supabase/migrations/20261011100000_efin_management.sql </code>  and then
        <code> supabase/migrations/20261012090000_efin_management_update.sql </code> on the Monarch Supabase project, then reload. Nothing else in the app is affected. <small>({message})</small>
      </div>
    );
  }
  return (
    <div className="monarch-notice">
      <b>DATABASE SETUP REQUIRED</b> The Monarch commerce tables are not available yet. Apply
      <code> supabase/migrations/20261009044133_monarch_commerce_licensing.sql </code>
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
