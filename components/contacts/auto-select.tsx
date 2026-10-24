"use client";

/** A drop-down that applies itself: choosing an option submits the form it sits in. */
export function AutoSelect({ name, defaultValue, options, label }: { name: string; defaultValue: string; options: { value: string; label: string }[]; label: string }) {
  return (
    <select name={name} defaultValue={defaultValue} aria-label={label} className="auto-select" onChange={(e) => e.currentTarget.form?.requestSubmit()}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
