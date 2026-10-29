"use client";

import { useState, type InputHTMLAttributes } from "react";
import { shapeMoney } from "@/lib/format/money-shape.ts";

export function SignedMoneyInput({ defaultValue, allowNegative = true, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "defaultValue" | "value" | "onChange" | "type"> & { defaultValue?: string; allowNegative?: boolean }) {
  const [value, setValue] = useState(() => shapeMoney(defaultValue ?? "", allowNegative, true));
  return (
    <input
      {...rest}
      type="text"
      inputMode="text"
      autoComplete="off"
      value={value}
      onChange={(e) => setValue(shapeMoney(e.target.value, allowNegative))}
      onBlur={() => setValue((v) => (v === "-" ? "" : shapeMoney(v, allowNegative, true)))}
    />
  );
}
