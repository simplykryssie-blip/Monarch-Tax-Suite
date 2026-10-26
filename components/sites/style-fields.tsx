"use client";

import { SHADOWS, WEIGHTS, type Look } from "@/lib/sites/look.ts";

// The design controls in the page builder's right-hand panel, for whatever is selected: colors, type, background and border,
// spacing, and where it shows. A change is a small patch; `undefined` clears a setting so the site's own style applies again.

type Patch = Partial<Look>;

function ColorField({ label, value, onChange, fallback }: { label: string; value: string | undefined; onChange: (v: string | undefined) => void; fallback: string }) {
  return (
    <div className="sf-color">
      <span>{label}</span>
      {value ? (
        <span className="sf-color-set"><input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} /><code>{value}</code><button type="button" onClick={() => onChange(undefined)} aria-label={`Clear ${label}`}>✕</button></span>
      ) : (
        <button type="button" className="sf-add" onClick={() => onChange(fallback)}>Choose</button>
      )}
    </div>
  );
}

function NumField({ label, value, onChange, min = 0, max = 240, unit = "px", placeholder }: { label: string; value: number | undefined; onChange: (v: number | undefined) => void; min?: number; max?: number; unit?: string; placeholder?: string }) {
  return (
    <label className="sf-num">{label}
      <span><input type="number" min={min} max={max} value={value ?? ""} placeholder={placeholder ?? "auto"} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} /><i>{unit}</i></span>
    </label>
  );
}

export function StyleFields({ look, onChange, onReset, showText }: { look: Look; onChange: (p: Patch) => void; onReset: () => void; showText: boolean }) {
  return (
    <div className="sf">
      {showText && (
        <details open>
          <summary>Text</summary>
          <div className="sf-body">
            <ColorField label="Color" value={look.color} onChange={(v) => onChange({ color: v })} fallback="#171714" />
            <div className="sf-grid">
              <NumField label="Size" value={look.size} min={10} max={120} onChange={(v) => onChange({ size: v })} />
              <label className="sf-num">Weight
                <select value={look.weight ?? ""} onChange={(e) => onChange({ weight: e.target.value ? (Number(e.target.value) as Look["weight"]) : undefined })}>
                  <option value="">Default</option>{WEIGHTS.map((w) => <option key={w} value={w}>{w === 400 ? "Regular" : w === 500 ? "Medium" : w === 600 ? "Semibold" : w === 700 ? "Bold" : "Extra bold"}</option>)}
                </select>
              </label>
              <NumField label="Letter spacing" value={look.spacing} min={-2} max={12} onChange={(v) => onChange({ spacing: v })} />
              <NumField label="Line height" value={look.line} min={0.9} max={2.6} unit="×" onChange={(v) => onChange({ line: v })} />
            </div>
            <div className="sf-seg" role="group" aria-label="Alignment">
              {(["left", "center", "right"] as const).map((a) => <button key={a} type="button" className={look.align === a ? "is-on" : undefined} aria-pressed={look.align === a} onClick={() => onChange({ align: look.align === a ? undefined : a })}>{a[0].toUpperCase() + a.slice(1)}</button>)}
            </div>
            <label className="sf-check"><input type="checkbox" checked={Boolean(look.italic)} onChange={(e) => onChange({ italic: e.target.checked || undefined })} /> Italic</label>
            <label className="sf-check"><input type="checkbox" checked={Boolean(look.upper)} onChange={(e) => onChange({ upper: e.target.checked || undefined })} /> UPPERCASE</label>
          </div>
        </details>
      )}
      <details open={!showText}>
        <summary>Background and border</summary>
        <div className="sf-body">
          <ColorField label="Background" value={look.bg} onChange={(v) => onChange({ bg: v })} fallback="#f6f3ea" />
          <div className="sf-grid">
            <NumField label="Rounded corners" value={look.radius} min={0} max={80} onChange={(v) => onChange({ radius: v })} />
            <NumField label="Border width" value={look.borderW} min={0} max={12} onChange={(v) => onChange({ borderW: v })} />
          </div>
          {look.borderW ? <ColorField label="Border color" value={look.borderColor} onChange={(v) => onChange({ borderColor: v })} fallback="#d9d4c7" /> : null}
          <label className="sf-num">Shadow
            <select value={look.shadow ?? ""} onChange={(e) => onChange({ shadow: (e.target.value || undefined) as Look["shadow"] })}>
              <option value="">None</option>{(Object.keys(SHADOWS) as (keyof typeof SHADOWS)[]).map((k) => <option key={k} value={k}>{k === "sm" ? "Soft" : k === "md" ? "Medium" : "Strong"}</option>)}
            </select>
          </label>
        </div>
      </details>
      <details>
        <summary>Spacing</summary>
        <div className="sf-body">
          <p className="sf-label">Inside (padding)</p>
          <div className="sf-grid sf-grid4">
            <NumField label="Top" value={look.padT} onChange={(v) => onChange({ padT: v })} />
            <NumField label="Right" value={look.padR} onChange={(v) => onChange({ padR: v })} />
            <NumField label="Bottom" value={look.padB} onChange={(v) => onChange({ padB: v })} />
            <NumField label="Left" value={look.padL} onChange={(v) => onChange({ padL: v })} />
          </div>
          <p className="sf-label">Outside (margin)</p>
          <div className="sf-grid">
            <NumField label="Above" value={look.marT} onChange={(v) => onChange({ marT: v })} />
            <NumField label="Below" value={look.marB} onChange={(v) => onChange({ marB: v })} />
          </div>
          <NumField label="Maximum width" value={look.maxW} min={120} max={1400} onChange={(v) => onChange({ maxW: v })} placeholder="full" />
        </div>
      </details>
      <details>
        <summary>Show on</summary>
        <div className="sf-body">
          <label className="sf-check"><input type="checkbox" checked={!look.hideDesktop} onChange={(e) => onChange({ hideDesktop: e.target.checked ? undefined : true })} /> Computers and tablets</label>
          <label className="sf-check"><input type="checkbox" checked={!look.hideMobile} onChange={(e) => onChange({ hideMobile: e.target.checked ? undefined : true })} /> Phones</label>
        </div>
      </details>
      <button type="button" className="monarch-secondary" onClick={onReset}>Reset style</button>
    </div>
  );
}
