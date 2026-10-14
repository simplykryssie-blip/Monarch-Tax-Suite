// CSV for the Compliance Center's exports. Cells that start like a spreadsheet formula are made safe.

const cell = (v: unknown) => {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

export const csvOf = (head: string[], rows: unknown[][]) => `﻿${[head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n")}\r\n`;
