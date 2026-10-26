"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/** Moves an item into a folder (null = the top level). Returns why not when it can't. */
export type MoveItem = (kind: "item" | "folder", id: string, to: string | null) => Promise<{ ok: true } | { ok: false; error: string }>;

/** Runs the move and reloads the page; a refusal is shown above the cards. */
function useDrop(scope: string, move: MoveItem, to: string | null) {
  const TYPE = `application/x-${scope}-item`;
  const router = useRouter();
  const [over, setOver] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [, start] = useTransition();
  const props = {
    onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes(TYPE)) { e.preventDefault(); setOver(true); } },
    onDragLeave: () => setOver(false),
    onDrop: (e: React.DragEvent) => {
      setOver(false);
      const raw = e.dataTransfer.getData(TYPE);
      if (!raw) return;
      e.preventDefault();
      const { kind, id } = JSON.parse(raw) as { kind: "item" | "folder"; id: string };
      if (id === to) return;
      start(async () => {
        const r = await move(kind, id, to);
        if (r.ok) router.refresh(); else setProblem(r.error);
      });
    },
  };
  return { over, problem, props };
}

/** A card you can pick up. When `dropTo` is given it is also a folder: drop an item or folder on it to put it inside. */
export function DragCard({ scope, move, kind, id, dropTo, className, style, children }: { scope: string; move: MoveItem; kind: "item" | "folder"; id: string; dropTo?: string; className?: string; style?: React.CSSProperties; children: React.ReactNode }) {
  const drop = useDrop(scope, move, dropTo ?? null);
  return (
    <section
      className={`${className ?? ""}${dropTo && drop.over ? " is-over" : ""}`}
      style={style}
      draggable
      onDragStart={(e) => { e.dataTransfer.setData(`application/x-${scope}-item`, JSON.stringify({ kind, id })); e.dataTransfer.effectAllowed = "move"; }}
      {...(dropTo ? drop.props : {})}
    >
      {children}
      {drop.problem && <p className="monarch-alert is-error" role="alert">{drop.problem}</p>}
    </section>
  );
}

/** A breadcrumb link that also takes drops: drop on the top level (to = null) or a parent folder to move something up. */
export function DropLink({ scope, move, to, href, current, children }: { scope: string; move: MoveItem; to: string | null; href: string; current?: boolean; children: React.ReactNode }) {
  const drop = useDrop(scope, move, to);
  return <Link href={href} aria-current={current ? "page" : undefined} className={drop.over ? "is-over" : undefined} {...drop.props}>{children}</Link>;
}

/** A table row you can pick up and drop on a folder. */
export function DragRow({ scope, id, children }: { scope: string; id: string; children: React.ReactNode }) {
  return <tr draggable onDragStart={(e) => { e.dataTransfer.setData(`application/x-${scope}-item`, JSON.stringify({ kind: "item", id })); e.dataTransfer.effectAllowed = "move"; }} style={{ cursor: "grab" }}>{children}</tr>;
}
