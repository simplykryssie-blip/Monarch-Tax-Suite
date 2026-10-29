"use client";

import { useState, type InputHTMLAttributes } from "react";
import { finishMoney, formatMoney } from "@/lib/format/ids.ts";

/** "-$1,234.50": a dollar amount that may start with a minus (money the client owes). Formatted as it is typed; decimals completed when leaving the box. */
const shape = (v: string, finish = false): string => {
  const negative = /^[\s$]*[-−(]/.test(v);
  const body = (finish ? finishMoney : formatMoney)(v.replace(/[-−()]/g, ""));
  return negative && body ? `-${body}` : body;
};

export function SignedMoneyInput({ defaultValue, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "defaultValue" | "value" | "onChange" | "type"> & { defaultValue?: string }) {
  const [value, setValue] = useState(() => shape(defaultValue ?? "", true));
  return <input {...rest} type="text" inputMode="text" autoComplete="off" value={value} onChange={(e) => setValue(shape(e.target.value))} onBlur={() => setValue((v) => shape(v, true))} />;
}
