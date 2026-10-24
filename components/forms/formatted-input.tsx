"use client";

import { useState, type InputHTMLAttributes } from "react";
import { FORMATTERS, INPUT_MODE, MAX_LENGTH, type IdKind } from "@/lib/format/ids.ts";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "defaultValue" | "value" | "onChange" | "inputMode" | "maxLength"> & {
  kind: IdKind;
  defaultValue?: string | null;
  /** Hide the digits as they are typed (a full Social Security number). The value is still shaped as it goes in. */
  secret?: boolean;
};

/** A text box that writes a phone number, SSN/ITIN, EIN, EFIN, PTIN, CAF or ZIP in its standard form as the person types or pastes. */
export function FormattedInput({ kind, defaultValue, secret, type, ...rest }: Props) {
  const format = FORMATTERS[kind];
  const [value, setValue] = useState(() => format(defaultValue ?? ""));
  return (
    <input
      {...rest}
      type={secret ? "password" : type === "tel" || kind === "phone" ? "tel" : "text"}
      inputMode={INPUT_MODE[kind]}
      maxLength={MAX_LENGTH[kind]}
      autoCapitalize={kind === "ptin" ? "characters" : undefined}
      value={value}
      onChange={(e) => setValue(format(e.target.value))}
    />
  );
}
