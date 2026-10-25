"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { finishClientDocAction, startClientDocAction } from "@/app/(admin)/workspace/actions";

/** Uploads a file straight to private storage with a one-time link, then asks the server to check it. */
export function ClientDocUpload({ clientId, returns }: { clientId: string; returns: { id: string; label: string }[] }) {
  const file = useRef<HTMLInputElement>(null);
  const title = useRef<HTMLInputElement>(null);
  const ret = useRef<HTMLSelectElement>(null);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function go() {
    const f = file.current?.files?.[0];
    if (!f) return setMsg({ ok: false, text: "Choose a file first." });
    setBusy(true);
    setMsg(null);
    try {
      const t = await startClientDocAction({ clientId, title: title.current?.value ?? "", fileName: f.name, sizeBytes: f.size, returnId: ret.current?.value || undefined });
      if (!t.ok) return setMsg({ ok: false, text: t.error });
      const res = await fetch(t.uploadUrl, { method: "PUT", headers: { "content-type": t.contentType, "x-upsert": "false" }, body: f });
      if (!res.ok) return setMsg({ ok: false, text: `The upload failed (storage answered ${res.status}). Try again.` });
      const done = await finishClientDocAction(t.id);
      if (!done.ok) return setMsg({ ok: false, text: done.error });
      if (file.current) file.current.value = "";
      if (title.current) title.current.value = "";
      setMsg({ ok: true, text: "Uploaded." });
      router.refresh();
    } catch {
      setMsg({ ok: false, text: "The upload was interrupted. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="monarch-form">
      <label>Name of the document<input ref={title} maxLength={200} placeholder="For example W-2 2025" /></label>
      {returns.length > 0 && <label>Which tax return is this for?<select ref={ret} defaultValue=""><option value="">None, keep it with the client</option>{returns.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label>}
      <label>File (PDF, Word, Excel or image, up to 25 MB)<input ref={file} type="file" accept=".pdf,.docx,.xlsx,.png,.jpg,.jpeg" /></label>
      <div className="is-wide"><button type="button" className="monarch-primary" onClick={go} disabled={busy}>{busy ? "Uploading…" : "Upload"}</button></div>
      {msg && <p className={msg.ok ? "monarch-alert" : "monarch-alert is-error"} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}
    </div>
  );
}
