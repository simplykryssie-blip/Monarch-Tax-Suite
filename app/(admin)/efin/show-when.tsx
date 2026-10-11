"use client";

import { useEffect, useRef, useState } from "react";

/** Shows its children only while the form field `name` is not one of `hideFor`. Hidden fields are also disabled so they are not submitted. */
export function ShowWhen({ name, hideFor, children }: { name: string; hideFor: string[]; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState<string | null>(null);
  useEffect(() => {
    const form = ref.current?.closest("form");
    const field = form?.querySelector<HTMLSelectElement>(`[name="${name}"]`);
    if (!field) return;
    const read = () => setValue(field.value);
    read();
    field.addEventListener("change", read);
    return () => field.removeEventListener("change", read);
  }, [name]);
  const hidden = value !== null && hideFor.includes(value);
  return (
    <div ref={ref} hidden={hidden}>
      <fieldset disabled={hidden} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>{children}</fieldset>
    </div>
  );
}
