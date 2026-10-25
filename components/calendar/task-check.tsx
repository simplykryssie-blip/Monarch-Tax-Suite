"use client";

import { toggleTaskAction } from "@/app/(admin)/workspace/actions";

/** A box that marks a task done as soon as it is ticked. */
export function TaskCheck({ id, source, back, title }: { id: string; source: "workflow" | "client"; back: string; title: string }) {
  return (
    <form action={toggleTaskAction} className="cal-check">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="source" value={source === "workflow" ? "workflow" : ""} />
      <input type="hidden" name="back" value={back} />
      <input type="hidden" name="done" value="yes" />
      <input type="checkbox" aria-label={`Mark done: ${title}`} onChange={(e) => e.currentTarget.form?.requestSubmit()} />
    </form>
  );
}
