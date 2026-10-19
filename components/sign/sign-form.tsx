"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { declineAction, signAction, type SignState } from "@/app/sign/[token]/actions";

/** Consent, then a typed or drawn signature and the printed name; or decline with an optional reason. */
export function SignForm({ token, consentText, signerName }: { token: string; consentText: string; signerName: string }) {
  const [state, sign, signing] = useActionState<SignState, FormData>(signAction, {});
  const [declineState, decline, declining] = useActionState<SignState, FormData>(declineAction, {});
  const [method, setMethod] = useState<"typed" | "drawn">("typed");
  const [drawn, setDrawn] = useState("");
  const [showDecline, setShowDecline] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  useEffect(() => {
    const c = canvas.current;
    if (!c || method !== "drawn") return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#0d1a59";
    const pos = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      return { x: ((e.clientX - r.left) * c.width) / r.width, y: ((e.clientY - r.top) * c.height) / r.height };
    };
    const down = (e: PointerEvent) => { drawing.current = true; c.setPointerCapture(e.pointerId); const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); };
    const move = (e: PointerEvent) => { if (!drawing.current) return; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); };
    const up = () => { if (!drawing.current) return; drawing.current = false; setDrawn(c.toDataURL("image/png")); };
    c.addEventListener("pointerdown", down);
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerup", up);
    c.addEventListener("pointerleave", up);
    return () => { c.removeEventListener("pointerdown", down); c.removeEventListener("pointermove", move); c.removeEventListener("pointerup", up); c.removeEventListener("pointerleave", up); };
  }, [method]);

  const clear = () => {
    const c = canvas.current;
    c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
    setDrawn("");
  };

  return (
    <>
      <form action={sign} className="monarch-form" style={{ display: "grid", gap: 14 }}>
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="method" value={method} />
        <input type="hidden" name="drawn" value={drawn} />
        <div role="region" aria-label="Consent to sign electronically" style={{ border: "1px solid #d9d4c7", borderRadius: 4, padding: 12, maxHeight: 220, overflowY: "auto", whiteSpace: "pre-wrap", background: "#faf8f3" }}>{consentText}</div>
        <label className="monarch-check"><input type="checkbox" name="consent" value="yes" required /> I have read and agree to the statement above, and I agree to sign this document electronically.</label>
        <label>Your full name<input name="signed_name" required minLength={2} maxLength={200} defaultValue={signerName} autoComplete="name" /></label>
        <fieldset style={{ border: 0, padding: 0 }}>
          <legend>Signature</legend>
          <label className="monarch-check"><input type="radio" name="m" checked={method === "typed"} onChange={() => setMethod("typed")} /> Type it</label>{" "}
          <label className="monarch-check"><input type="radio" name="m" checked={method === "drawn"} onChange={() => setMethod("drawn")} /> Draw it</label>
          {method === "typed" ? (
            <input name="typed" aria-label="Type your signature" required minLength={2} maxLength={120} defaultValue={signerName} style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontStyle: "italic", fontSize: 22 }} />
          ) : (
            <div>
              <canvas ref={canvas} width={600} height={160} aria-label="Draw your signature" style={{ width: "100%", maxWidth: 600, height: 160, border: "1px dashed #8a8473", borderRadius: 4, touchAction: "none", background: "#fff" }} />
              <button type="button" className="monarch-secondary" onClick={clear}>Clear</button>
            </div>
          )}
        </fieldset>
        {state.error && <p className="monarch-alert is-error" role="alert">{state.error}</p>}
        <button className="monarch-primary" disabled={signing || (method === "drawn" && !drawn)}>{signing ? "Signing…" : "Sign document"}</button>
      </form>
      <div style={{ marginTop: 24 }}>
        {!showDecline ? (
          <button type="button" className="monarch-secondary" onClick={() => setShowDecline(true)}>I do not want to sign</button>
        ) : (
          <form action={decline} className="monarch-form" style={{ display: "grid", gap: 10 }}>
            <input type="hidden" name="token" value={token} />
            <label>Reason (optional, shared with the sender)<textarea name="reason" rows={3} maxLength={1000} /></label>
            {declineState.error && <p className="monarch-alert is-error" role="alert">{declineState.error}</p>}
            <button className="monarch-secondary is-danger" disabled={declining}>{declining ? "Declining…" : "Decline to sign"}</button>
          </form>
        )}
      </div>
    </>
  );
}
