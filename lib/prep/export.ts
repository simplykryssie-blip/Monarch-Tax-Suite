import { createHash } from "node:crypto";
import type { Client, ClientDoc, ClientReturn } from "../workspace/types.ts";
import { RETURN_KINDS } from "../workspace/types.ts";
import type { ChecklistItem } from "./types.ts";

// The file a PTIN holder sends an ERO when handing a return over: a plain CSV a person can open anywhere. It is built
// from what the holder chooses to send; it carries no internal ids and no other tenant's data, and only the last 4
// digits of an SSN (all the workspace ever keeps).

// A cell that starts with = + - @ (or a tab/return) could be run as a formula by a spreadsheet; a leading ' makes it text.
const cell = (v: string | number | null | undefined) => {
  let s = String(v ?? "").replace(/\r\n|\r/g, "\n");
  if (/^[=+\-@\t]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const row = (...cols: (string | number | null | undefined)[]) => cols.map(cell).join(",");

export function handoffCsv(input: { client: Client; ret: ClientReturn; items: ChecklistItem[]; docs: Pick<ClientDoc, "title" | "file_type">[]; preparer: string }): string {
  const { client: c, ret: r } = input;
  const lines = [
    row("Section", "Field", "Value"),
    row("Client", "Name", c.full_name),
    row("Client", "Email", c.email),
    row("Client", "Phone", c.phone),
    row("Client", "SSN (last 4)", c.ssn_last4),
    row("Client", "Address", c.address),
    row("Return", "Tax year", r.tax_year),
    row("Return", "Type", RETURN_KINDS[r.kind]),
    row("Return", "Due", r.due_on),
    row("Return", "Prep notes", r.notes),
    row("Return", "Prepared by", input.preparer),
    ...input.items.map((i) => row("Checklist", i.label, i.done_at ? "Done" : "Open")),
    ...input.docs.map((d) => row("Document on file", d.title, d.file_type)),
  ];
  return lines.join("\r\n") + "\r\n";
}

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "client";
export const handoffFileName = (c: Pick<Client, "full_name">, r: Pick<ClientReturn, "tax_year" | "kind">) => `return-${r.tax_year}-${r.kind}-${slug(c.full_name)}.csv`;
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
