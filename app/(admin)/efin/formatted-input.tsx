"use client";

import type { InputHTMLAttributes } from "react";
import { maskEfinInput, maskEinInput, maskPhoneInput, maskPtinInput, maskStateInput, maskZipInput } from "@/lib/efin/format.ts";

const MASKS = { phone: maskPhoneInput, ein: maskEinInput, efin: maskEfinInput, ptin: maskPtinInput, state: maskStateInput, zip: maskZipInput } as const;
const HINTS: Record<keyof typeof MASKS, Partial<InputHTMLAttributes<HTMLInputElement>>> = {
  phone: { type: "tel", inputMode: "tel", autoComplete: "off", placeholder: "(555) 010-2030" },
  ein: { inputMode: "numeric", autoComplete: "off", placeholder: "12-3456789" },
  efin: { inputMode: "numeric", autoComplete: "off", placeholder: "123456" },
  ptin: { autoComplete: "off", placeholder: "P01234567" },
  state: { autoComplete: "off" },
  zip: { inputMode: "numeric", autoComplete: "off" },
};

/** A text box that formats as you type (phone, EIN, EFIN, PTIN, state, ZIP). The server applies the same format when saving. */
export function FormattedInput({ kind, onInput, ...props }: { kind: keyof typeof MASKS } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...HINTS[kind]}
      {...props}
      onInput={(e) => {
        const el = e.currentTarget;
        const masked = MASKS[kind](el.value);
        if (masked !== el.value) el.value = masked;
        onInput?.(e);
      }}
    />
  );
}
