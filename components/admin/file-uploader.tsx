"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { finishFileUploadAction, startFileUploadAction } from "@/app/(admin)/product-file-actions";

/**
 * Sends a file straight from the browser to private storage with a one-time URL, then asks the server to confirm it.
 * The file is always stored as plain binary data, so nothing uploaded here is ever rendered or run by the site.
 */
export function FileUploader({ productId, accept }: { productId: string; accept: string }) {
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function upload() {
    const file = input.current?.files?.[0];
    if (!file) return setMessage({ ok: false, text: "Choose a file first." });
    setBusy(true);
    setMessage(null);
    try {
      const ticket = await startFileUploadAction(productId, file.name, file.size);
      if (!ticket.ok) return setMessage({ ok: false, text: ticket.error });
      const res = await fetch(ticket.uploadUrl, { method: "PUT", headers: { "content-type": ticket.contentType, "x-upsert": "false" }, body: file });
      if (!res.ok) return setMessage({ ok: false, text: `The upload failed (storage answered ${res.status}). Try again.` });
      const done = await finishFileUploadAction(productId, ticket.fileId);
      if (!done.ok) return setMessage({ ok: false, text: done.error });
      setMessage({ ok: true, text: `${done.fileName} uploaded.` });
      if (input.current) input.current.value = "";
      router.refresh();
    } catch {
      setMessage({ ok: false, text: "The upload was interrupted. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="monarch-inline-actions">
      <input ref={input} type="file" accept={accept} disabled={busy} aria-label="File to upload" />
      <button type="button" className="monarch-secondary" onClick={upload} disabled={busy}>{busy ? "Uploading…" : "Upload file"}</button>
      {message && <p className={message.ok ? "monarch-muted" : "monarch-alert is-error"} role="status">{message.text}</p>}
    </div>
  );
}
