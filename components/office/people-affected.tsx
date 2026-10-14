"use client";

import { useState } from "react";
import { FTC_NOTICE, FTC_THRESHOLD } from "@/lib/compliance/rules.ts";

/** The "people affected" field. The FTC notice appears as soon as the count reaches 500. */
export function PeopleAffected({ defaultValue = "" }: { defaultValue?: string }) {
  const [value, setValue] = useState(defaultValue);
  const n = Number(value.replace(/[\s,]/g, ""));
  return (
    <>
      <label>People affected (if known)<input name="people_affected" inputMode="numeric" placeholder="Number of people" value={value} onChange={(e) => setValue(e.target.value)} /></label>
      {Number.isFinite(n) && n >= FTC_THRESHOLD && <p className="is-wide monarch-alert is-error compliance-ftc-live" role="alert">{FTC_NOTICE}</p>}
    </>
  );
}
