"use client";

import { useActionState, useState } from "react";
import { downloadFileAction, listDownloadsAction, type DownloadsState } from "@/app/downloads/actions";

const size = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export function DownloadsForm() {
  const [state, action, pending] = useActionState<DownloadsState, FormData>(listDownloadsAction, {});
  const [key, setKey] = useState("");
  return (
    <>
      <form action={action} className="monarch-form">
        <label className="is-wide">License key
          <input name="license_key" required value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" placeholder="MTS-XXXXX-XXXXX-XXXXX-XXXXX" />
        </label>
        <div className="is-wide"><button className="monarch-secondary" disabled={pending} type="submit">{pending ? "Checking…" : "Show my downloads"}</button></div>
      </form>
      {state.error && <p className="monarch-alert is-error">{state.error}</p>}
      {state.files && (
        <div className="monarch-form-done">
          <h2>{state.product}</h2>
          {state.files.length === 0 ? (
            <p>There are no files to download for this product yet.</p>
          ) : (
            <ul>
              {state.files.map((f) => (
                <li key={f.id}>
                  <form action={downloadFileAction} style={{ display: "inline" }}>
                    <input type="hidden" name="license_key" value={key} />
                    <input type="hidden" name="file_id" value={f.id} />
                    <button className="monarch-primary" type="submit">Download {f.name}</button>
                  </form>{" "}
                  <small>{size(f.size)}</small>
                </li>
              ))}
            </ul>
          )}
          <p><small>Each download link works for 60 seconds. Install the files on your own website or computer by following the product&apos;s instructions.</small></p>
        </div>
      )}
    </>
  );
}
