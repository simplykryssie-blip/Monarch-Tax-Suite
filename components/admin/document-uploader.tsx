"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { finishDocumentUploadAction, startDocumentUploadAction } from "@/app/(admin)/documents/actions";

/**
 * Uploads a PDF or Word document straight to the tenant's private document storage with a one-time URL, then asks
 * the server to check it by content and read its merge fields. With `documentId` it adds a new version.
 */
export function DocumentUploader({ documentId, folderId, accept = ".pdf,.docx" }: { documentId?: string; /** A new document goes into this folder. */ folderId?: string; accept?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const name = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function upload() {
    const file = input.current?.files?.[0];
    if (!file) return setMessage({ ok: false, text: "Choose a PDF or Word (.docx) file first." });
    setBusy(true);
    setMessage(null);
    try {
      const ticket = await startDocumentUploadAction({ documentId: documentId ?? null, name: name.current?.value ?? "", fileName: file.name, sizeBytes: file.size, folderId: folderId ?? null });
      if (!ticket.ok) return setMessage({ ok: false, text: ticket.error });
      const res = await fetch(ticket.uploadUrl, { method: "PUT", headers: { "content-type": ticket.contentType, "x-upsert": "false" }, body: file });
      if (!res.ok) return setMessage({ ok: false, text: `The upload failed (storage answered ${res.status}). Try again.` });
      const done = await finishDocumentUploadAction(ticket.versionId);
      if (!done.ok) return setMessage({ ok: false, text: done.error });
      if (input.current) input.current.value = "";
      if (documentId) {
        setMessage({ ok: true, text: `New version uploaded. ${done.fields.length ? `Merge fields: ${done.fields.join(", ")}.` : "No merge fields."}` });
        router.refresh();
      } else {
        router.push(`/documents/${done.documentId}?notice=${encodeURIComponent("Document uploaded.")}`);
      }
    } catch {
      setMessage({ ok: false, text: "The upload was interrupted. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="monarch-inline-actions" style={{ flexWrap: "wrap" }}>
      {!documentId && <input ref={name} placeholder="Name (optional; defaults to the file name)" maxLength={120} disabled={busy} aria-label="Document name" />}
      <input ref={input} type="file" accept={accept} disabled={busy} aria-label="Document file" />
      <button type="button" className="monarch-primary" onClick={upload} disabled={busy}>{busy ? "Uploading…" : documentId ? "Upload new version" : "Upload document"}</button>
      {message && <p className={message.ok ? "monarch-muted" : "monarch-alert is-error"} role="status">{message.text}</p>}
    </div>
  );
}
