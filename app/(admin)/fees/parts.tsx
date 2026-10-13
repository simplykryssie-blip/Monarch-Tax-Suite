import Link from "next/link";
import { dollars } from "@/lib/fees/engine.ts";

// Small pieces shared by the Fees & Statements pages.

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function FeesNav({ active }: { active: "overview" | "schedule" | "import" | "bank" | "history" }) {
  const items: [typeof active, string, string][] = [
    ["overview", "Offices", "/fees"],
    ["schedule", "Fee schedule", "/fees/schedule"],
    ["import", "Import returns", "/fees/import"],
    ["bank", "Bank imports", "/fees/bank"],
    ["history", "History", "/fees/history"],
  ];
  return (
    <nav className="fees-tabs" aria-label="Fees & Statements">
      {items.map(([k, label, href]) => <Link key={k} href={href} className={k === active ? "is-active" : undefined} aria-current={k === active ? "page" : undefined}>{label}</Link>)}
    </nav>
  );
}

export function YearPicker({ year, action, extra }: { year: number; action: string; extra?: Record<string, string> }) {
  const years = Array.from({ length: 6 }, (_, i) => new Date().getUTCFullYear() - i);
  return (
    <form method="get" action={action} className="efin-filter">
      {Object.entries(extra ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <label className="fees-inline">Tax year
        <select name="year" defaultValue={String(year)}>{[...new Set([year, ...years])].sort((a, b) => b - a).map((y) => <option key={y} value={y}>{y}</option>)}</select>
      </label>
      <button className="monarch-secondary efin-small">Show</button>
    </form>
  );
}

export const Money = ({ cents, strong }: { cents: number; strong?: boolean }) => (strong ? <b>{dollars(cents)}</b> : <>{dollars(cents)}</>);
