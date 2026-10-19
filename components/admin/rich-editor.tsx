"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { editorToMarkdown, markdownToEditorHtml } from "@/lib/richtext-editor.ts";

// A visual editor that saves Markdown (see lib/richtext.ts). "email" has the full bar: text type, size, colour, bold,
// italic, underline, lists, placeholders, links and pictures. "form" is the short bar for a form's paragraph blocks.

type Placeholder = { name: string; note: string };
type Props = {
  name: string;
  initial: string;
  variant: "email" | "form";
  placeholders?: Placeholder[];
  maxLength?: number;
  rows?: number;
  label?: string;
  onChange?: (markdown: string) => void;
  /** Stores a picture in the account's own storage and returns its address (email variant only). */
  uploadImage?: (form: FormData) => Promise<{ ok: true; url: string } | { ok: false; error: string }>;
};

const SIZES = [["Small", 13], ["Normal", 0], ["Large", 20], ["Huge", 28]] as const;

function ToolButton({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" className="re-btn" title={title} aria-label={title} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>{children}</button>;
}

export function RichEditor({ name, initial, variant, placeholders = [], maxLength = 20000, rows = 12, label = "Message", onChange, uploadImage }: Props) {
  const area = useRef<HTMLDivElement>(null);
  const saved = useRef<Range | null>(null);
  const [md, setMd] = useState(initial);
  const [source, setSource] = useState(false);
  const [panel, setPanel] = useState<null | "link" | "image">(null);
  const [url, setUrl] = useState("https://");
  const [alt, setAlt] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const email = variant === "email";

  const publish = useCallback((next: string) => { setMd(next); onChange?.(next); }, [onChange]);

  // Load the starting text once; after that the editor owns its content.
  useEffect(() => {
    if (area.current) {
      area.current.innerHTML = markdownToEditorHtml(initial);
      try { document.execCommand("defaultParagraphSeparator", false, "p"); } catch { /* older browsers */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const keep = () => {
      const sel = window.getSelection();
      if (sel && sel.rangeCount && area.current?.contains(sel.anchorNode)) saved.current = sel.getRangeAt(0).cloneRange();
    };
    document.addEventListener("selectionchange", keep);
    return () => document.removeEventListener("selectionchange", keep);
  }, []);

  const sync = useCallback(() => { if (area.current) publish(editorToMarkdown(area.current)); }, [publish]);

  function restore() {
    area.current?.focus();
    const sel = window.getSelection();
    if (sel && saved.current) { sel.removeAllRanges(); sel.addRange(saved.current); }
  }
  function run(cmd: string, value?: string) {
    restore();
    // Colour is written as a style; bold, italic and underline as plain <b>, <i> and <u> tags.
    document.execCommand("styleWithCSS", false, cmd === "foreColor" ? "true" : "false");
    document.execCommand(cmd, false, value);
    sync();
  }

  function setSize(px: number) {
    restore();
    document.execCommand("styleWithCSS", false, "false");
    if (px === 0) {
      // Back to normal: unwrap any size on the selection.
      document.execCommand("fontSize", false, "3");
    } else {
      document.execCommand("fontSize", false, "7");
    }
    area.current?.querySelectorAll<HTMLElement>("font[size]").forEach((f) => {
      const span = document.createElement("span");
      if (f.getAttribute("size") === "7" && px) span.style.fontSize = `${px}px`;
      if (f.style.color) span.style.color = f.style.color;
      span.innerHTML = f.innerHTML;
      f.replaceWith(span);
    });
    sync();
  }

  function insertPlaceholder(token: string) {
    if (!token) return;
    restore();
    document.execCommand("insertHTML", false, `<span data-token="${token}" contenteditable="false" class="re-chip">{{${token}}}</span>&nbsp;`);
    sync();
  }

  function applyLink() {
    if (!/^(https:\/\/|mailto:)[^\s<>"']+$/.test(url.trim())) { setProblem("Links must start with https:// (or mailto:)."); return; }
    setProblem(null);
    restore();
    const sel = window.getSelection();
    if (sel && sel.isCollapsed) document.execCommand("insertHTML", false, `<a href="${url.trim().replace(/"/g, "")}">${url.trim().replace(/[<>&]/g, "")}</a>`);
    else document.execCommand("createLink", false, url.trim());
    setPanel(null); setUrl("https://");
    sync();
  }

  function applyImage() {
    if (!/^https:\/\/[^\s<>"']+$/.test(url.trim())) { setProblem("Picture addresses must start with https://"); return; }
    setProblem(null);
    restore();
    document.execCommand("insertHTML", false, `<img src="${url.trim().replace(/"/g, "")}" alt="${alt.replace(/["<>]/g, "")}">`);
    setPanel(null); setUrl("https://"); setAlt("");
    sync();
  }

  async function uploadPicture(file: File | undefined) {
    if (!file || !uploadImage) return;
    if (file.size > 4 * 1024 * 1024) { setProblem("Pictures can be at most 4 MB."); return; }
    setProblem(null);
    setUploading(true);
    const form = new FormData();
    form.set("file", file);
    form.set("alt", alt);
    try {
      const r = await uploadImage(form);
      if (r.ok) setUrl(r.url);
      else setProblem(r.error);
    } catch {
      setProblem("The picture could not be uploaded. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="re">
      <input type="hidden" name={name} value={md} />
      <span className="field-label">{label}</span>
      <div className="re-bar" role="toolbar" aria-label="Formatting">
        {email && (
          <select aria-label="Text type" defaultValue="p" onChange={(e) => { run("formatBlock", e.target.value); e.target.value = "p"; }} disabled={source}>
            <option value="p">Body</option><option value="h1">Heading</option><option value="h2">Subheading</option>
          </select>
        )}
        {email && (
          <select aria-label="Text size" defaultValue="" onChange={(e) => { if (e.target.value !== "") setSize(Number(e.target.value)); e.target.value = ""; }} disabled={source}>
            <option value="">Size</option>
            {SIZES.map(([l, px]) => <option key={l} value={px}>{l}</option>)}
          </select>
        )}
        {email && <label className="re-color" title="Text colour"><span aria-hidden="true">A</span><input type="color" aria-label="Text colour" defaultValue="#b00020" onChange={(e) => run("foreColor", e.target.value)} disabled={source} /></label>}
        <ToolButton title="Bold" onClick={() => run("bold")}><b>B</b></ToolButton>
        <ToolButton title="Italic" onClick={() => run("italic")}><i>I</i></ToolButton>
        <ToolButton title="Underline" onClick={() => run("underline")}><u>U</u></ToolButton>
        <ToolButton title="Bulleted list" onClick={() => run("insertUnorderedList")}>• List</ToolButton>
        <ToolButton title="Numbered list" onClick={() => run("insertOrderedList")}>1. List</ToolButton>
        <ToolButton title="Add a link" onClick={() => { setPanel(panel === "link" ? null : "link"); setProblem(null); }}>Link</ToolButton>
        {email && <ToolButton title="Add a picture" onClick={() => { setPanel(panel === "image" ? null : "image"); setProblem(null); }}>Picture</ToolButton>}
        {email && placeholders.length > 0 && (
          <select aria-label="Insert placeholder" defaultValue="" onChange={(e) => { insertPlaceholder(e.target.value); e.target.value = ""; }} disabled={source}>
            <option value="">Insert placeholder…</option>
            {placeholders.map((p) => <option key={p.name} value={p.name} title={p.note}>{p.name.replace(/_/g, " ")}</option>)}
          </select>
        )}
        <label className="re-source"><input type="checkbox" checked={source} onChange={(e) => { setSource(e.target.checked); if (!e.target.checked && area.current) area.current.innerHTML = markdownToEditorHtml(md); }} /> Markdown</label>
      </div>
      {panel && (
        <div className="re-panel">
          <input aria-label={panel === "link" ? "Link address" : "Picture address"} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
          {panel === "image" && <input aria-label="Picture description" value={alt} onChange={(e) => setAlt(e.target.value)} placeholder="Describe the picture" maxLength={120} />}
          {panel === "image" && uploadImage && (
            <label className="monarch-secondary efin-small" style={{ cursor: "pointer" }}>
              {uploading ? "Uploading…" : "Upload a picture"}
              <input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={uploading} onChange={(e) => { void uploadPicture(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
          )}
          <button type="button" className="monarch-primary efin-small" disabled={uploading} onClick={panel === "link" ? applyLink : applyImage}>{panel === "link" ? "Add link" : "Add picture"}</button>
          <button type="button" className="monarch-secondary efin-small" onClick={() => setPanel(null)}>Cancel</button>
        </div>
      )}
      {problem && <p className="field-error" role="alert">{problem}</p>}
      {email && placeholders.length > 0 && (
        <details className="re-placeholders">
          <summary>Placeholders you can use</summary>
          <ul>
            {placeholders.map((p) => (
              <li key={p.name}>
                <button type="button" className="re-token" onMouseDown={(e) => e.preventDefault()} onClick={() => insertPlaceholder(p.name)} disabled={source} title="Click to insert into the message">{`{{${p.name}}}`}</button>
                <span className="monarch-muted"> {p.note}</span>
              </li>
            ))}
          </ul>
          <small className="monarch-muted">Click one to put it into the message at the cursor. Values are escaped before sending, so a customer&apos;s name can never inject markup.</small>
        </details>
      )}
      <div
        ref={area}
        className="re-area"
        contentEditable={!source}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        style={{ minHeight: rows * 22, display: source ? "none" : undefined }}
        onInput={sync}
        onBlur={sync}
      />
      {source && (
        <textarea className="re-source-area" rows={rows} maxLength={maxLength} value={md} onChange={(e) => publish(e.target.value)} aria-label={`${label} as Markdown`} />
      )}
      <small className="monarch-muted">{md.length.toLocaleString()} / {maxLength.toLocaleString()} characters{md.length > maxLength ? " (too long)" : ""}</small>
    </div>
  );
}
