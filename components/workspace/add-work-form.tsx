"use client";

import { useState } from "react";
import { addReturnAction, addWorkAction } from "@/app/(admin)/workspace/actions";
import { RETURN_KINDS } from "@/lib/workspace/types.ts";

type Option = { id: string; name: string; returns: boolean };

/** The Add popup on the Work board: pick the client and the pipeline; tax returns ask for a year and kind, other work for a label. */
export function AddWorkForm({ clients, pipelines, pipelineId, year, back }: { clients: { id: string; name: string }[]; pipelines: Option[]; pipelineId: string; year: number; back: string }) {
  const [chosen, setChosen] = useState(pipelineId);
  const isReturn = pipelines.find((p) => p.id === chosen)?.returns ?? true;
  return (
    <form action={isReturn ? addReturnAction : addWorkAction} className="monarch-form">
      <input type="hidden" name="back" value={back} />
      <label>Client *<select name="client_id" required defaultValue=""><option value="" disabled>Choose a client…</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>Pipeline *<select name="pipeline_id" value={chosen} onChange={(e) => setChosen(e.target.value)}>{pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      {isReturn ? (
        <>
          <label>Tax year *<input name="tax_year" required inputMode="numeric" maxLength={4} defaultValue={year} /></label>
          <label>Kind<select name="kind" defaultValue="original">{Object.entries(RETURN_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        </>
      ) : (
        <label>Label<input name="title" maxLength={200} placeholder="October books" /></label>
      )}
      <label>Due date<input name="due_on" type="date" /></label>
      <div className="is-wide"><button className="monarch-primary">Add</button></div>
    </form>
  );
}
