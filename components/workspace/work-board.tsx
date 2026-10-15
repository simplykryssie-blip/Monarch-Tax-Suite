"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { moveReturnAction } from "@/app/(admin)/workspace/actions";
import type { BoardColumn } from "@/lib/workspace/rules.ts";

const KIND = { original: "Original", extension: "Extension", amendment: "Amendment" } as const;

/** The My Work board: a column per pipeline stage. Drag a card to another column to move it; click a card to open its client. */
export function WorkBoard({ columns }: { columns: BoardColumn[] }) {
  const [cols, setCols] = useState(columns);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [, start] = useTransition();

  function drop(stageId: string) {
    setOver(null);
    const id = drag;
    setDrag(null);
    if (!id) return;
    const from = cols.find((c) => c.cards.some((k) => k.id === id));
    if (!from || from.stage.id === stageId) return;
    const before = cols;
    const card = from.cards.find((k) => k.id === id)!;
    // Move it on screen at once; put it back if the server refuses.
    setCols(cols.map((c) => (c.stage.id === from.stage.id ? { ...c, cards: c.cards.filter((k) => k.id !== id) } : c.stage.id === stageId ? { ...c, cards: [...c.cards, { ...card, stageId, late: card.late && !c.stage.done }] } : c)));
    setProblem(null);
    start(async () => {
      const r = await moveReturnAction(id, stageId);
      if (!r.ok) { setCols(before); setProblem(r.error); }
    });
  }

  return (
    <>
      {problem && <p className="monarch-alert is-error" role="alert">{problem}</p>}
      <div className="wb" role="list" aria-label="Returns by stage">
        {cols.map((c) => (
          <section
            key={c.stage.id}
            role="listitem"
            aria-label={`${c.stage.name}: ${c.cards.length}`}
            className={"wb-col" + (over === c.stage.id ? " is-over" : "")}
            style={{ borderTopColor: c.stage.color }}
            onDragOver={(e) => { e.preventDefault(); setOver(c.stage.id); }}
            onDragLeave={() => setOver((o) => (o === c.stage.id ? null : o))}
            onDrop={() => drop(c.stage.id)}
          >
            <div className="wb-head"><span>{c.stage.name}</span><small>{c.cards.length}</small></div>
            <div className="wb-cards">
              {c.cards.length === 0 && <span className="wb-empty">Drop a return here</span>}
              {c.cards.map((k) => (
                <article key={k.id} className={"wb-card" + (drag === k.id ? " is-drag" : "")} draggable onDragStart={() => setDrag(k.id)} onDragEnd={() => { setDrag(null); setOver(null); }}>
                  <Link href={`/workspace/clients/${k.clientId}?tab=work#return-${k.id}`}>{k.clientName}</Link>
                  <span><span className={`wb-kind is-${k.kind}`}>{KIND[k.kind]}</span> {k.taxYear}</span>
                  {k.dueOn && <small className={k.late ? "wb-late" : "monarch-muted"}>{k.late ? "Late · " : "Due "}{k.dueOn}</small>}
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
