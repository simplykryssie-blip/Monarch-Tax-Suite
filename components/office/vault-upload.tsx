"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { finishUploadAction, startUploadAction } from "@/app/office/(area)/compliance/actions";
import { DOC_KINDS } from "@/lib/compliance/types.ts";

/**
 * Uploads a PDF or Word file straight to the office's private vault with a one-time link, then asks the server to check
 * it by content. With `kind` the kind is fixed (for example a WISP); `onDone` receives the new file's id.
 */
export function VaultUpload({ kind, label = "Upload", returnTo }: { kind?: keyof typeof DOC_KINDS; label?: string; returnTo?: string }) {
  const file = useRef<HTMLInputElement>(null);
  const title = useRef<HTMLInputElement>(null);
  const kindRef = useRef<HTMLSelectElement>(null);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function go() {
    const f = file.current?.files?.[0];
    if (!f) return setMsg({ ok: false, text: "Choose a PDF or Word (.docx) file first." });
    setBusy(true);
    setMsg(null);
    try {
      const t = await startUploadAction({ kind: kind ?? kindRef.current?.value ?? "other", title: title.current?.value ?? "", fileName: f.name, sizeBytes: f.size });
      if (!t.ok) return setMsg({ ok: false, text: t.error });
      const res = await fetch(t.uploadUrl, { method: "PUT", headers: { "content-type": t.contentType, "x-upsert": "false" }, body: f });
      if (!res.ok) return setMsg({ ok: false, text: `The upload failed (storage answered ${res.status}). Try again.` });
      const done = await finishUploadAction(t.id);
      if (!done.ok) return setMsg({ ok: false, text: done.error });
      if (file.current) file.current.value = "";
      if (title.current) title.current.value = "";
      setMsg({ ok: true, text: "Uploaded to the vault." });
      if (returnTo) router.push(`${returnTo}${returnTo.includes("?") ? "&" : "?"}uploaded=${done.id}`);
      else router.refresh();
    } catch {
      setMsg({ ok: false, text: "The upload was interrupted. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="vault-upload">
      {!kind && (
        <label>Kind
          <select ref={kindRef} defaultValue="8879">{Object.entries(DOC_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </label>
      )}
      <label>Title<input ref={title} maxLength={200} placeholder="For example 8879 — Smith 2025" /></label>
      <label>File (PDF or Word, up to 25 MB)<input ref={file} type="file" accept=".pdf,.docx" /></label>
      <button type="button" className="monarch-primary" onClick={go} disabled={busy}>{busy ? "Uploading…" : label}</button>
      {msg && <p className={msg.ok ? "monarch-alert" : "monarch-alert is-error"} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}
    </div>
  );
}
