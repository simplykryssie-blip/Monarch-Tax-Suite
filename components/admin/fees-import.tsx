"use client";

import { useState, useTransition } from "react";
import { importBankAction, importReturnsAction, previewImportAction } from "@/app/(admin)/fees/actions";
import type { Field } from "@/lib/fees/csv.ts";
import type { BankResult, ImportResult } from "@/lib/fees/service.ts";
import type { Mapping } from "@/lib/fees/types.ts";

// A CSV import in three steps: choose the file, match its columns to the fields, import. The file is read in the
// browser and only sent when it's imported; the last column choices are suggested next time.

type Props =
  | { kind: "returns"; fields: Field[]; offices: { id: string; name: string }[]; defaultOffice: string; defaultYear: number }
  | { kind: "bank"; fields: Field[]; banks: { id: string; name: string }[] };

export function FeesImport(props: Props) {
  const [text, setText] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<{ headers: string[]; sample: string[][]; rowCount: number } | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [target, setTarget] = useState(props.kind === "returns" ? props.defaultOffice : props.banks[0]?.id ?? "");
  const [year, setYear] = useState(props.kind === "returns" ? String(props.defaultYear) : "");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ImportResult | BankResult | null>(null);
  const [pending, start] = useTransition();

  const choose = (file: File | undefined) => {
    setError(null); setDone(null); setPreview(null);
    if (!file) return;
    if (file.size > 2_000_000) { setError("That file is too large. Split it into files under 2 MB."); return; }
    setFileName(file.name);
    file.text().then((t) => {
      setText(t);
      start(async () => {
        const r = await previewImportAction(props.kind, t);
        if (!r.ok) { setError(r.error); return; }
        setPreview({ headers: r.headers, sample: r.sample, rowCount: r.rowCount });
        setMapping(r.mapping);
      });
    }, () => setError("That file couldn't be read."));
  };

  const run = () => {
    if (!text) return;
    setError(null);
    start(async () => {
      const r = props.kind === "returns"
        ? await importReturnsAction({ officeId: target, taxYear: year, text, mapping })
        : await importBankAction({ bankId: target, fileName, text, mapping });
      if (!r.ok) { setError(r.error); return; }
      setDone(r.result); setPreview(null); setText(null);
    });
  };

  return (
    <div className="fees-import">
      <div className="monarch-form">
        {props.kind === "returns" ? (
          <>
            <label>Office<select value={target} onChange={(e) => setTarget(e.target.value)} required><option value="">Choose the office…</option>{props.offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
            <label>Tax year (when the file has no tax year column)<input value={year} onChange={(e) => setYear(e.target.value)} inputMode="numeric" /></label>
          </>
        ) : (
          <label>Bank<select value={target} onChange={(e) => setTarget(e.target.value)} required><option value="">Choose the bank…</option>{props.banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
        )}
        <label className="is-wide">CSV file<input type="file" accept=".csv,text/csv,text/plain" onChange={(e) => choose(e.target.files?.[0])} /></label>
      </div>

      {error && <p className="efin-form-error" role="alert">{error}</p>}
      {pending && <p className="monarch-muted">Working…</p>}

      {preview && (
        <div className="fees-mapping">
          <h3>Match the columns · {preview.rowCount.toLocaleString("en-US")} rows in {fileName}</h3>
          <div className="monarch-form">
            {props.fields.map((f) => (
              <label key={f.key}>{f.label}{f.required ? " *" : ""}
                <select value={mapping[f.key] ?? ""} onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value })}>
                  <option value="">{f.required ? "Choose a column…" : "Not in this file"}</option>
                  {preview.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </label>
            ))}
          </div>
          <div className="monarch-table-wrap"><table>
            <thead><tr>{preview.headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>{preview.sample.map((r, i) => <tr key={i}>{preview.headers.map((h, j) => <td key={h}>{r[j] ?? ""}</td>)}</tr>)}</tbody>
          </table></div>
          <button type="button" className="monarch-primary" disabled={pending || !target} onClick={run}>Import {preview.rowCount.toLocaleString("en-US")} rows</button>
        </div>
      )}

      {done && (
        <div className="monarch-notice" role="status">
          {"created" in done
            ? <><b>IMPORTED</b> {done.created} new returns recorded and charged, {done.updated} updated.</>
            : <><b>IMPORTED</b> {done.matched} rows matched a return; {done.unmatched} didn&apos;t and are listed below to link.</>}
          {done.skipped.length > 0 && (
            <>
              {" "}{done.skipped.length} rows were skipped:
              <ul>{done.skipped.slice(0, 50).map((s) => <li key={s.row}>Row {s.row}: {s.reason}</li>)}</ul>
              {done.skipped.length > 50 && <p>…and {done.skipped.length - 50} more.</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
