import Link from "next/link";
import { label } from "@/components/admin/ui";
import { Icon, type IconName } from "@/components/admin/icons";
import type { OrgRow, PersonRow } from "@/lib/efin/types";

export function Kpi({ href, icon, title, value, sub }: { href: string; icon: IconName; title: string; value: number | string; sub: string }) {
  return (
    <Link href={href} className="mt-kpi">
      <div className="mt-kpi-top"><span>{title}</span><span className="mt-kpi-ico"><Icon name={icon} size={20} /></span></div>
      <div className="mt-kpi-value">{value}</div>
      <div className="mt-kpi-foot"><span className="mt-kpi-sub">{sub}</span><span className="mt-kpi-go">Open <Icon name="arrow" size={13} /></span></div>
    </Link>
  );
}

/** How trustworthy a recorded fact is. Never reads as an IRS result. */
export function Verified({ value }: { value: string }) {
  const text = value === "manually_verified" ? "Manually verified" : value === "verified" ? "Verified" : value === "not_applicable" ? "Not applicable" : "Unverified";
  return <span className={"monarch-badge " + (value === "unverified" ? "pending" : value === "not_applicable" ? "skipped" : "verified")}>{text}</span>;
}

export const orgName = (orgs: OrgRow[], id: string | null) => orgs.find((o) => o.id === id)?.legal_name ?? "—";
export const personName = (people: PersonRow[], id: string | null) => people.find((p) => p.id === id)?.full_name ?? "—";
export { label };

export function Select({ name, options, value, empty, required }: { name: string; options: { value: string; label: string }[]; value?: string | null; empty?: string; required?: boolean }) {
  return (
    <select name={name} defaultValue={value ?? ""} required={required}>
      {empty !== undefined && <option value="">{empty}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export const VERIFY_OPTIONS = [
  { value: "unverified", label: "Unverified" },
  { value: "manually_verified", label: "Manually verified (I checked it myself)" },
  { value: "verified", label: "Verified (from a source I can name)" },
];
