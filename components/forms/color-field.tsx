"use client";

import { useState } from "react";

/** A colour that can also be left alone ("use the standard look"): submits an empty value when switched off. */
export function ColorField({ name, label, value }: { name: string; label: string; value: string | null }) {
  const [on, setOn] = useState(!!value);
  const [color, setColor] = useState(value ?? "#1f3a5f");
  return (
    <label>{label}
      <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <input type="color" value={color} onChange={(e) => { setColor(e.target.value); setOn(true); }} aria-label={label} style={{ width: 54, height: 36, padding: 2 }} />
        <span className="monarch-check" style={{ fontWeight: 400 }}><input type="checkbox" checked={!on} onChange={(e) => setOn(!e.target.checked)} /> Standard</span>
        <input type="hidden" name={name} value={on ? color : ""} />
      </span>
    </label>
  );
}
