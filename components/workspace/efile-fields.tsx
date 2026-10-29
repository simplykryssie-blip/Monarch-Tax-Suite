"use client";

import { useState } from "react";
import { EFILE_STATUSES, type EfileStatus } from "@/lib/workspace/types.ts";

/** E-file status and date. The "why" box appears only when the status is Rejected. */
export function EfileFields({ status, on, reason }: { status: EfileStatus; on: string; reason: string }) {
  const [now, setNow] = useState<EfileStatus>(status);
  return (
    <>
      <label>E-file
        <select name="efile_status" value={now} onChange={(e) => setNow(e.target.value as EfileStatus)}>
          {Object.entries(EFILE_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <label>E-file date<input type="date" name="efile_on" defaultValue={on} /></label>
      {now === "rejected" && (
        <label className="is-wide">Why it was rejected<input name="efile_reject_reason" maxLength={500} defaultValue={reason} placeholder="The reject code or reason from your software" /></label>
      )}
    </>
  );
}
