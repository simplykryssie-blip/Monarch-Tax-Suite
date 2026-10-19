"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { finishPortalUploadAction, startPortalUploadAction } from "@/app/portal/documents-actions";

/** Uploads a PDF, JPG or PNG straight to private storage with a one-time link, then asks the server to check it. */
export function PortalUpload({ requestId, label }: { requestId?: string; label?: string }) {
  const file = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function go() {
    const f = file.current?.files?.[0];
    if (!f) return setMsg({ ok: false, text: "Choose a file first." });
    setBusy(true);
    setMsg(null);
    try {
      const t = await startPortalUploadAction({ fileName: f.name, sizeBytes: f.size, requestId });
      if (!t.ok) return setMsg({ ok: false, text: t.error });
      const res = await fetch(t.uploadUrl, { method: "PUT", headers: { "content-type": t.contentType, "x-upsert": "false" }, body: f });
      if (!res.ok) return setMsg({ ok: false, text: `The upload failed (storage answered ${res.status}). Try again.` });
      const done = await finishPortalUploadAction(t.id);
      if (!done.ok) return setMsg({ ok: false, text: done.error });
      if (file.current) file.current.value = "";
      setMsg({ ok: true, text: "Uploaded. Thank you." });
      router.refresh();
    } catch {
      setMsg({ ok: false, text: "The upload was interrupted. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="monarch-form portal-upload">
      <label>{label ?? "File (PDF, JPG or PNG, up to 15 MB)"}<input ref={file} type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" /></label>
      <div className="is-wide"><button type="button" className="monarch-primary" onClick={go} disabled={busy}>{busy ? "Uploading…" : "Upload"}</button></div>
      {msg && <p className={msg.ok ? "monarch-alert" : "monarch-alert is-error"} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}
    </div>
  );
}
