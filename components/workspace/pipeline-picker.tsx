"use client";

import { useRouter } from "next/navigation";

/** Choose which pipeline's board to view. */
export function PipelinePicker({ pipelines, current }: { pipelines: { id: string; name: string }[]; current: string }) {
  const router = useRouter();
  return (
    <label className="monarch-inline-form">Pipeline
      <select value={current} onChange={(e) => router.push(`/workspace/work?pipeline=${e.target.value}`)}>
        {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </label>
  );
}
