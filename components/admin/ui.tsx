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

// The message is kept for logs only; people are told to contact support.
/* eslint-disable-next-line @typescript-eslint/no-unused-vars */
export function SetupRequired({ message: _message, module }: { message: string; module?: "efin" }) {
  if (module === "efin") {
    return (
      <div className="monarch-notice">
        <b>NOT SET UP YET</b> This part of your account isn&apos;t ready yet. Please contact support and we&apos;ll finish setting it up. Nothing else is affected. 
      </div>
    );
  }
  return (
    <div className="monarch-notice">
      <b>NOT SET UP YET</b> This part of your account isn&apos;t ready yet. Please contact support and we&apos;ll finish setting it up. Nothing else is affected. 
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
