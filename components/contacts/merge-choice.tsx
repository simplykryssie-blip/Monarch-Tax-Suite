"use client";

import { useState } from "react";

/** Pick which of two records to keep when merging. The other one's details move onto it and the other is archived. */
export function MergeChoice({ thisId, thisName, otherId, otherName }: { thisId: string; thisName: string; otherId: string; otherName: string }) {
  const [keepThis, setKeepThis] = useState(true);
  return (
    <>
      <input type="hidden" name="keep" value={keepThis ? thisId : otherId} />
      <input type="hidden" name="drop" value={keepThis ? otherId : thisId} />
      <fieldset className="is-wide mc-keep">
        <legend>Keep which record?</legend>
        <label className="monarch-check"><input type="radio" checked={keepThis} onChange={() => setKeepThis(true)} /> {thisName}</label>
        <label className="monarch-check"><input type="radio" checked={!keepThis} onChange={() => setKeepThis(false)} /> {otherName}</label>
      </fieldset>
    </>
  );
}
