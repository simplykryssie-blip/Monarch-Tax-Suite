"use client";

import { RichText } from "./rich-text";
import { useEffect, useMemo, useRef, useState } from "react";
import { removeFormUploadAction, saveFormForLaterAction, startFormUploadAction, submitFormAction, type SubmitResult } from "@/app/f/[id]/actions";
import { checkAnswer, US_STATES } from "@/lib/forms/answers";
import { DISPLAY_TYPES, type DateBound, type Field, type FormDefinition } from "@/lib/forms/definition";
import { evaluate, type RawAnswer, type RawAnswers } from "@/lib/forms/logic";
import type { SignaturePayload } from "@/lib/forms/signature-input";

// The form a respondent fills in: one page at a time, the same show/hide and skip logic the server runs, files
// uploaded straight to private storage, a signature with the firm's own consent text, and save-for-later.

type Mode = "live" | "preview" | "test";
type FileRef = { id: string; name: string };
type Sig = { consent: boolean; name: string; method: "typed" | "drawn"; typed: string; drawn: string };

export type FormRendererProps = {
  publicId: string;
  definition: FormDefinition;
  formName: string;
  description?: string | null;
  firmName: string;
  consentText: string | null;
  allowSaveLater: boolean;
  respondentEmailKey: string | null;
  stamp: string;
  initialAnswers?: RawAnswers;
  initialToken?: string | null;
  mode: Mode;
  /** Test mode: the administrator's test-submission action. */
  testSubmit?: (input: { token: string | null; answers: RawAnswers; signature: SignaturePayload; stamp: string }) => Promise<SubmitResult>;
};

const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const boundDay = (b: DateBound | null | undefined, today: string) => {
  if (!b) return undefined;
  if (b.kind === "fixed") return b.date;
  return new Date(Date.parse(`${today}T00:00:00Z`) + b.days * 86_400_000).toISOString().slice(0, 10);
};
const ACCEPT: Record<string, string> = { pdf: ".pdf,application/pdf", jpg: ".jpg,.jpeg,image/jpeg", png: ".png,image/png" };

function SignaturePad({ onChange, disabled }: { onChange: (dataUrl: string) => void; disabled?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#0d1a59";
    const pos = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      return { x: ((e.clientX - r.left) * c.width) / r.width, y: ((e.clientY - r.top) * c.height) / r.height };
    };
    const down = (e: PointerEvent) => { drawing.current = true; c.setPointerCapture(e.pointerId); const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); };
    const move = (e: PointerEvent) => { if (!drawing.current) return; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); };
    const up = () => { if (!drawing.current) return; drawing.current = false; onChange(c.toDataURL("image/png")); };
    c.addEventListener("pointerdown", down);
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerup", up);
    c.addEventListener("pointerleave", up);
    return () => { c.removeEventListener("pointerdown", down); c.removeEventListener("pointermove", move); c.removeEventListener("pointerup", up); c.removeEventListener("pointerleave", up); };
  }, [onChange]);
  const clear = () => {
    const c = canvas.current;
    c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
    onChange("");
  };
  return (
    <div>
      <canvas ref={canvas} width={600} height={160} aria-label="Draw your signature" style={{ width: "100%", maxWidth: 600, height: 160, border: "1px dashed #8a8473", borderRadius: 4, touchAction: "none", background: "#fff", pointerEvents: disabled ? "none" : undefined }} />
      <button type="button" className="monarch-secondary" onClick={clear} disabled={disabled}>Clear</button>
    </div>
  );
}

export function FormRenderer(props: FormRendererProps) {
  const { definition: def, mode } = props;
  const [answers, setAnswers] = useState<RawAnswers>(props.initialAnswers ?? {});
  const [pageId, setPageId] = useState(def.pages[0]?.id ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<Record<string, string>>({});
  const [sig, setSig] = useState<Sig>({ consent: false, name: "", method: "typed", typed: "", drawn: "" });
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveEmail, setSaveEmail] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const honeypot = useRef<HTMLInputElement>(null);
  const token = useRef<string | null>(props.initialToken ?? null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const today = useMemo(todayLocal, []);
  const live = mode !== "preview";

  const logic = useMemo(() => evaluate(def, answers), [def, answers]);
  const pathIndex = Math.max(0, logic.path.indexOf(pageId));
  const page = def.pages.find((p) => p.id === pageId) ?? def.pages[0];
  const isLast = pathIndex >= logic.path.length - 1;
  const set = (key: string, v: RawAnswer) => {
    setAnswers((a) => ({ ...a, [key]: v }));
    setErrors((e) => (e[key] ? { ...e, [key]: "" } : e));
  };
  const setDrawn = useMemo(() => (d: string) => setSig((s) => ({ ...s, drawn: d })), []);

  const signatureError = (f: Field): string | null => {
    const signed = sig.method === "typed" ? sig.typed.trim().length >= 2 : !!sig.drawn;
    if (!f.required && !signed && !sig.consent) return null;
    if (!sig.consent) return "Tick the box to agree to sign electronically.";
    if (sig.name.trim().length < 2) return "Type your full name to sign.";
    if (!signed) return sig.method === "typed" ? "Type your signature." : "Draw your signature in the box.";
    return null;
  };
  const pageErrors = (pid: string) => {
    const out: Record<string, string> = {};
    const p = def.pages.find((x) => x.id === pid);
    for (const s of p?.sections ?? []) for (const f of s.fields) {
      if (!logic.visible.has(f.id) || DISPLAY_TYPES.includes(f.type)) continue;
      if (f.type === "signature") {
        const e = signatureError(f);
        if (e) out[f.key] = e;
        continue;
      }
      if (uploading[f.key]) { out[f.key] = "Wait for the upload to finish."; continue; }
      const r = checkAnswer(f, answers[f.key], today);
      if (r.error) out[f.key] = r.error;
    }
    return out;
  };
  const go = (pid: string) => {
    setPageId(pid);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const next = () => {
    const e = pageErrors(page.id);
    setErrors(e);
    if (Object.keys(e).length) return;
    const n = logic.path[pathIndex + 1];
    if (n) go(n);
  };
  const back = () => {
    const p = logic.path[pathIndex - 1];
    if (p) go(p);
  };

  const signatureField = def.pages.flatMap((p) => p.sections.flatMap((s) => s.fields)).find((f) => f.type === "signature");
  const signaturePayload = (): SignaturePayload => {
    if (!signatureField || !logic.visible.has(signatureField.id)) return null;
    const signed = sig.method === "typed" ? sig.typed.trim() : sig.drawn;
    if (!signed && !sig.consent) return null;
    return { consent: sig.consent, signedName: sig.name, method: sig.method, typed: sig.method === "typed" ? sig.typed : undefined, drawn: sig.method === "drawn" ? sig.drawn : undefined };
  };

  async function submit() {
    if (!live) return;
    const e = pageErrors(page.id);
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setFormError(null);
    try {
      await queue.current;
      const input = { token: token.current, answers, signature: signaturePayload(), stamp: props.stamp };
      const result = mode === "test" && props.testSubmit ? await props.testSubmit(input) : await submitFormAction(props.publicId, { ...input, honeypot: honeypot.current?.value ?? "" });
      if (result.ok) {
        // Say so straight away, then load the confirmation page in full. A soft navigation right after an action that
        // sets the receipt cookie can be undone by the action's own refresh, which left people looking at the form.
        setSent(result.redirect);
        window.location.assign(result.redirect);
        return;
      }
      setFormError(result.error);
      if (result.errors) {
        setErrors(result.errors);
        const keys = Object.keys(result.errors);
        const target = logic.path.find((pid) => def.pages.find((p) => p.id === pid)?.sections.some((s) => s.fields.some((f) => keys.includes(f.key))));
        if (target) go(target);
      }
    } catch {
      setFormError("The connection was interrupted. Your answers are still here; please try again.");
    } finally {
      setBusy(false);
    }
  }

  function addFiles(f: Field, files: FileList | null) {
    if (!files?.length || !live) return;
    const current = (Array.isArray(answers[f.key]) ? answers[f.key] : []) as FileRef[];
    const room = (f.maxFiles ?? 1) - current.length;
    const list = Array.from(files).slice(0, Math.max(0, room));
    if (!list.length) {
      setErrors((e) => ({ ...e, [f.key]: `You can add at most ${f.maxFiles ?? 1} file${(f.maxFiles ?? 1) > 1 ? "s" : ""}. Remove one first.` }));
      return;
    }
    for (const file of list) {
      // One upload at a time: the first one creates this respondent's draft, and the rest join it.
      queue.current = queue.current.then(async () => {
        setUploading((u) => ({ ...u, [f.key]: file.name }));
        try {
          const t = await startFormUploadAction(props.publicId, { token: token.current, fieldKey: f.key, fileName: file.name, sizeBytes: file.size });
          if (!t.ok) {
            setErrors((e) => ({ ...e, [f.key]: t.error }));
            return;
          }
          token.current = t.token;
          const res = await fetch(t.uploadUrl, { method: "PUT", headers: { "content-type": t.contentType, "x-upsert": "false" }, body: file });
          if (!res.ok) {
            setErrors((e) => ({ ...e, [f.key]: `"${file.name}" did not upload. Check your connection and try again.` }));
            return;
          }
          setAnswers((a) => ({ ...a, [f.key]: [...((Array.isArray(a[f.key]) ? a[f.key] : []) as FileRef[]), { id: t.uploadId, name: t.fileName }] }));
          setErrors((e) => ({ ...e, [f.key]: "" }));
        } catch {
          setErrors((e) => ({ ...e, [f.key]: `"${file.name}" did not upload. Check your connection and try again.` }));
        } finally {
          setUploading((u) => ({ ...u, [f.key]: "" }));
        }
      });
    }
  }
  function removeFile(f: Field, id: string) {
    set(f.key, ((answers[f.key] ?? []) as FileRef[]).filter((x) => x.id !== id));
    if (token.current) void removeFormUploadAction(props.publicId, token.current, id);
  }

  async function saveLater() {
    if (mode !== "live") return;
    setBusy(true);
    setFormError(null);
    try {
      await queue.current;
      const email = saveEmail || (props.respondentEmailKey && typeof answers[props.respondentEmailKey] === "string" ? (answers[props.respondentEmailKey] as string) : "");
      const r = await saveFormForLaterAction(props.publicId, { token: token.current, answers, email });
      if (!r.ok) setFormError(r.error);
      else {
        token.current = r.token;
        setSaved(r.email);
        setSaveOpen(false);
      }
    } finally {
      setBusy(false);
    }
  }

  const input = (f: Field) => {
    const id = `q-${f.id}`;
    const v = answers[f.key];
    const err = errors[f.key];
    const aria = { "aria-invalid": err ? true : undefined, "aria-describedby": err ? `${id}-err` : f.help ? `${id}-help` : undefined } as const;
    const text = typeof v === "string" ? v : "";
    switch (f.type) {
      case "heading":
        return <h2 style={{ margin: "8px 0 0", fontSize: 20 }}>{f.label}</h2>;
      case "paragraph":
        return <RichText text={f.text ?? ""} />;
      case "long_text":
        return <textarea id={id} rows={5} maxLength={f.maxLength ?? 5000} placeholder={f.placeholder} value={text} onChange={(e) => set(f.key, e.target.value)} {...aria} />;
      case "dropdown":
        return (
          <select id={id} value={text} onChange={(e) => set(f.key, e.target.value)} {...aria}>
            <option value="">Choose…</option>
            {f.options?.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        );
      case "radio":
        return (
          <div role="radiogroup" aria-labelledby={`${id}-label`} className="mf-choices" {...aria}>
            {f.options?.map((o) => <label key={o} className="monarch-check"><input type="radio" name={id} checked={text === o} onChange={() => set(f.key, o)} /> {o}</label>)}
          </div>
        );
      case "checkboxes": {
        const list = Array.isArray(v) ? (v as string[]) : [];
        return (
          <div role="group" aria-labelledby={`${id}-label`} className="mf-choices" {...aria}>
            {f.options?.map((o) => <label key={o} className="monarch-check"><input type="checkbox" checked={list.includes(o)} onChange={(e) => set(f.key, e.target.checked ? [...list, o] : list.filter((x) => x !== o))} /> {o}</label>)}
          </div>
        );
      }
      case "date":
        return <input id={id} type="date" value={text} min={boundDay(f.dateMin, today)} max={boundDay(f.dateMax, today)} onChange={(e) => set(f.key, e.target.value)} {...aria} />;
      case "address": {
        const a = (v && typeof v === "object" && !Array.isArray(v) ? v : {}) as Record<string, string>;
        const part = (k: string, value: string) => set(f.key, { ...a, [k]: value });
        const us = !f.country || /^(us|usa|united states( of america)?)?$/i.test(a.country ?? "");
        return (
          <div className="mf-address" {...aria}>
            <input aria-label={`${f.label}: street`} placeholder="Street address" autoComplete="address-line1" value={a.line1 ?? ""} onChange={(e) => part("line1", e.target.value)} maxLength={200} />
            {f.line2 && <input aria-label={`${f.label}: line 2`} placeholder="Apartment, suite (optional)" autoComplete="address-line2" value={a.line2 ?? ""} onChange={(e) => part("line2", e.target.value)} maxLength={200} />}
            <div className="mf-address-row">
              <input aria-label={`${f.label}: city`} placeholder="City" autoComplete="address-level2" value={a.city ?? ""} onChange={(e) => part("city", e.target.value)} maxLength={100} />
              {us ? (
                <select aria-label={`${f.label}: state`} value={a.state ?? ""} onChange={(e) => part("state", e.target.value)} autoComplete="address-level1">
                  <option value="">State</option>
                  {US_STATES.map((st) => <option key={st} value={st}>{st}</option>)}
                </select>
              ) : (
                <input aria-label={`${f.label}: state or region`} placeholder="State / region" value={a.state ?? ""} onChange={(e) => part("state", e.target.value)} maxLength={60} />
              )}
              <input aria-label={`${f.label}: ZIP code`} placeholder={us ? "ZIP" : "Postal code"} inputMode={us ? "numeric" : "text"} autoComplete="postal-code" value={a.zip ?? ""} onChange={(e) => part("zip", e.target.value)} maxLength={20} />
            </div>
            {f.country && <input aria-label={`${f.label}: country`} placeholder="Country" autoComplete="country-name" value={a.country ?? "United States"} onChange={(e) => part("country", e.target.value)} maxLength={80} />}
          </div>
        );
      }
      case "file": {
        const files = (Array.isArray(v) ? v : []) as FileRef[];
        const kinds = f.fileTypes ?? ["pdf"];
        return (
          <div className="mf-files" {...aria}>
            {files.map((x) => (
              <div key={x.id} className="mf-file"><span>{x.name || "Uploaded file"}</span><button type="button" className="monarch-link" onClick={() => removeFile(f, x.id)}>Remove</button></div>
            ))}
            {uploading[f.key] && <div className="mf-file" role="status">Uploading {uploading[f.key]}…</div>}
            {files.length < (f.maxFiles ?? 1) && (
              <input id={id} type="file" multiple={(f.maxFiles ?? 1) > 1} accept={kinds.map((k) => ACCEPT[k]).join(",")} disabled={!live} onChange={(e) => { addFiles(f, e.target.files); e.target.value = ""; }} />
            )}
            <small className="monarch-muted">{kinds.map((k) => k.toUpperCase()).join(", ")}, up to 10 MB each{(f.maxFiles ?? 1) > 1 ? `, at most ${f.maxFiles} files` : ""}.</small>
          </div>
        );
      }
      case "signature":
        return (
          <div className="mf-signature">
            {props.consentText ? <div role="region" aria-label="Consent to sign electronically" className="mf-consent">{props.consentText}</div> : <p className="monarch-alert is-error">This form has no signing consent statement yet.</p>}
            <label className="monarch-check"><input type="checkbox" checked={sig.consent} onChange={(e) => setSig((s) => ({ ...s, consent: e.target.checked }))} /> I have read and agree to the statement above, and I agree to sign electronically.</label>
            <label>Your full name<input value={sig.name} onChange={(e) => setSig((s) => ({ ...s, name: e.target.value }))} maxLength={200} autoComplete="name" /></label>
            <div className="mf-choices">
              <label className="monarch-check"><input type="radio" name={`${id}-m`} checked={sig.method === "typed"} onChange={() => setSig((s) => ({ ...s, method: "typed" }))} /> Type it</label>
              <label className="monarch-check"><input type="radio" name={`${id}-m`} checked={sig.method === "drawn"} onChange={() => setSig((s) => ({ ...s, method: "drawn" }))} /> Draw it</label>
            </div>
            {sig.method === "typed" ? (
              <input aria-label="Type your signature" value={sig.typed} onChange={(e) => setSig((s) => ({ ...s, typed: e.target.value }))} maxLength={120} style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontStyle: "italic", fontSize: 22 }} />
            ) : (
              <SignaturePad onChange={setDrawn} disabled={!live} />
            )}
          </div>
        );
      default: {
        const type = f.type === "email" ? "email" : f.type === "phone" ? "tel" : "text";
        const mode = f.type === "number" ? (f.decimals ? "decimal" : "numeric") : f.format === "efin" || f.format === "ein" ? "numeric" : undefined;
        const auto = f.sensitive ? "off" : f.type === "email" ? "email" : f.type === "phone" ? "tel" : undefined;
        return <input id={id} type={type} inputMode={mode} autoComplete={auto} spellCheck={f.sensitive ? false : undefined} maxLength={f.type === "short_text" && !f.format ? f.maxLength ?? 200 : 60} placeholder={f.placeholder} value={text} onChange={(e) => set(f.key, e.target.value)} {...aria} />;
      }
    }
  };

  if (sent) {
    return (
      <div className="mf-form" role="status" aria-live="polite">
        <div className="monarch-eyebrow">{props.firmName.toUpperCase()}</div>
        <h1>Thank you, your submission was received</h1>
        <p>{mode === "test" ? "The TEST submission was saved." : "We have your answers, files and signature."} {/^https:/.test(sent) ? "Taking you on now…" : "Opening your confirmation…"}</p>
        <p><a className="monarch-primary" href={sent} style={{ display: "inline-block", textDecoration: "none" }}>{/^https:/.test(sent) ? "Continue" : "View your confirmation"}</a></p>
      </div>
    );
  }

  return (
    <div className="mf-form">
      {mode === "preview" && <p className="monarch-notice"><b>PREVIEW</b> This is how the form looks. Nothing can be submitted here.</p>}
      {mode === "test" && <p className="monarch-notice"><b>TEST</b> Submissions here are marked TEST: they are saved with a PDF, but nobody is notified and no records or workflows are touched.</p>}
      <div className="monarch-eyebrow">{props.firmName.toUpperCase()}</div>
      <h1>{props.formName}</h1>
      {props.description && <p>{props.description}</p>}
      {logic.path.length > 1 && (
        <div className="mf-progress" aria-label={`Page ${pathIndex + 1} of ${logic.path.length}`}>
          <div style={{ width: `${((pathIndex + 1) / logic.path.length) * 100}%` }} />
          <small>Page {pathIndex + 1} of {logic.path.length}{page.title ? `: ${page.title}` : ""}</small>
        </div>
      )}
      {saved && <p className="monarch-notice" role="status"><b>SAVED</b> We emailed a link to {saved}. Use it within 30 days to finish the form.</p>}
      <form className="monarch-form" onSubmit={(e) => { e.preventDefault(); if (isLast) void submit(); else next(); }} noValidate>
        {/* Left empty by people; filled in by bots. */}
        <input ref={honeypot} type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: "absolute", left: -9999, width: 1, height: 1, opacity: 0 }} />
        {page.sections.map((s) => {
          const fields = s.fields.filter((f) => logic.visible.has(f.id));
          if (!fields.length) return null;
          return (
            <section key={s.id} className="is-wide mf-section">
              {s.title && <h2>{s.title}</h2>}
              {s.description && <p className="monarch-muted" style={{ whiteSpace: "pre-wrap" }}>{s.description}</p>}
              <div className="monarch-form">
                {fields.map((f) => {
                  const display = DISPLAY_TYPES.includes(f.type);
                  const grouped = ["radio", "checkboxes", "address", "file", "signature"].includes(f.type);
                  const cls = f.width === "half" && !grouped ? "" : "is-wide";
                  if (display) return <div key={f.id} className="is-wide">{input(f)}</div>;
                  return (
                    <div key={f.id} className={`mf-field ${cls}`}>
                      <label htmlFor={grouped ? undefined : `q-${f.id}`} id={`q-${f.id}-label`} className="mf-label">
                        {f.label}{f.required ? <span aria-hidden="true" className="mf-req"> *</span> : <span className="monarch-muted"> (optional)</span>}
                      </label>
                      {f.help && <small id={`q-${f.id}-help`} className="monarch-muted" style={{ whiteSpace: "pre-wrap" }}>{f.help}</small>}
                      {input(f)}
                      {errors[f.key] && <small id={`q-${f.id}-err`} className="mf-error" role="alert">{errors[f.key]}</small>}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
        {formError && <p className="monarch-alert is-error is-wide" role="alert">{formError}</p>}
        <div className="is-wide mf-nav">
          {pathIndex > 0 && <button type="button" className="monarch-secondary" onClick={back} disabled={busy}>Back</button>}
          {isLast ? (
            <button className="monarch-primary" disabled={busy || !live}>{busy ? "Submitting…" : mode === "test" ? "Submit test" : "Submit"}</button>
          ) : (
            <button className="monarch-primary" disabled={busy}>Next</button>
          )}
        </div>
      </form>
      {props.allowSaveLater && mode === "live" && (
        <div className="mf-savelater">
          {!saveOpen ? (
            <button type="button" className="monarch-link" onClick={() => setSaveOpen(true)} disabled={busy}>Save and continue later</button>
          ) : (
            <div className="monarch-inline-form" style={{ flexWrap: "wrap" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
                Email a link to finish later
                <input type="email" autoComplete="email" value={saveEmail || (props.respondentEmailKey && typeof answers[props.respondentEmailKey] === "string" ? (answers[props.respondentEmailKey] as string) : "")} onChange={(e) => setSaveEmail(e.target.value)} />
              </label>
              <button type="button" className="monarch-primary" onClick={saveLater} disabled={busy}>{busy ? "Saving…" : "Save and email me the link"}</button>
              <small className="monarch-muted">Your answers and files are kept for 30 days. Signatures aren&apos;t saved; you sign when you finish.</small>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
