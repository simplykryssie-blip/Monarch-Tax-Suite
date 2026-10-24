"use client";

import { useEffect, useId, useRef, useState } from "react";
import { resolveState, STATE_CODES, STATES } from "@/lib/format/states.ts";

/**
 * A state box with a drop-down list. Pick from the list, or type the abbreviation (tx) or the name (Texas): it is written as the
 * two letters (TX) when you leave the box. Something that isn't a state stops the form and asks for one from the list.
 */
export function StateSelect({ name, defaultValue, label = "State", required }: { name: string; defaultValue?: string | null; label?: string; required?: boolean }) {
  const list = useId();
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState((defaultValue ?? "").toUpperCase());
  const valid = value === "" || STATE_CODES.has(value);
  useEffect(() => { input.current?.setCustomValidity(valid ? "" : "Choose a state from the list."); }, [valid, value]);
  return (
    <>
      <input
        ref={input}
        name={name}
        list={list}
        value={value}
        required={required}
        placeholder="State"
        aria-label={label}
        aria-invalid={!valid}
        autoComplete="off"
        maxLength={24}
        onChange={(e) => setValue(e.target.value.toUpperCase())}
        onBlur={() => setValue((v) => resolveState(v))}
      />
      <datalist id={list}>{STATES.map(([code, state]) => <option key={code} value={code}>{state}</option>)}</datalist>
    </>
  );
}
