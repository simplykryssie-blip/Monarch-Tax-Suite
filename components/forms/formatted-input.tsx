"use client";

import { useState, type InputHTMLAttributes } from "react";
import { finishMoney, FORMATTERS, INPUT_MODE, MAX_LENGTH, type IdKind } from "@/lib/format/ids.ts";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "defaultValue" | "value" | "onChange" | "inputMode" | "maxLength"> & {
  kind: IdKind;
  defaultValue?: string | null;
  /** Controlled use: the current value, and a function told each time it changes (already formatted). */
  value?: string;
  onValue?: (value: string) => void;
  /** Hide the digits as they are typed (a full Social Security number). The value is still shaped as it goes in. */
  secret?: boolean;
};

/** A text box that writes a phone number, SSN/ITIN, EIN, EFIN, PTIN, CAF or ZIP in its standard form as the person types or pastes. */
export function FormattedInput({ kind, defaultValue, value: controlled, onValue, secret, type, ...rest }: Props) {
  const format = FORMATTERS[kind];
  const [own, setOwn] = useState(() => format(defaultValue ?? ""));
  const value = controlled ?? own;
  const setValue = (next: string | ((v: string) => string)) => { const v = typeof next === "function" ? next(value) : next; setOwn(v); onValue?.(v); };
  const [shown, setShown] = useState(false);
  const field = (
    <input
      {...rest}
      type={secret && !shown ? "password" : type === "tel" || kind === "phone" ? "tel" : "text"}
      inputMode={INPUT_MODE[kind]}
      maxLength={MAX_LENGTH[kind]}
      autoCapitalize={kind === "ptin" ? "characters" : undefined}
      value={value}
      onChange={(e) => setValue(format(e.target.value))}
      onBlur={kind === "money" ? () => setValue((v) => finishMoney(v)) : undefined}
    />
  );
  if (!secret) return field;
  const label = shown ? "Hide what I typed" : "Show what I typed";
  return (
    <span className="fi-wrap">
      {field}
      <button type="button" className="fi-eye" aria-label={label} title={label} aria-pressed={shown} onClick={() => setShown((s) => !s)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
          <circle cx="12" cy="12" r="3" />
          {shown && <path d="M4 4l16 16" />}
        </svg>
      </button>
    </span>
  );
}
