"use client";

/** The box in the table header: ticks or unticks every contact box in the same form. */
export function SelectAll() {
  return (
    <input
      type="checkbox"
      aria-label="Select all contacts shown"
      onChange={(e) => {
        const form = e.currentTarget.form;
        form?.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name="key"]').forEach((b) => { b.checked = e.currentTarget.checked; });
      }}
    />
  );
}
