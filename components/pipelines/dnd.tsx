"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { moveByDragAction } from "@/app/(admin)/pipelines/actions";

const TYPE = "application/x-pipeline-item";

/** Runs the move and reloads the page; a refusal is shown above the cards. */
function useDrop(to: string | null) {
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
      const { kind, id } = JSON.parse(raw) as { kind: "pipeline" | "folder"; id: string };
      if (id === to) return;
      start(async () => {
        const r = await moveByDragAction(kind, id, to);
        if (r.ok) router.refresh(); else setProblem(r.error);
      });
    },
  };
  return { over, problem, props };
}

/** A card you can pick up. When `dropTo` is given it is also a folder: drop a pipeline or folder on it to put it inside. */
export function DragCard({ kind, id, dropTo, className, style, children }: { kind: "pipeline" | "folder"; id: string; dropTo?: string; className?: string; style?: React.CSSProperties; children: React.ReactNode }) {
  const drop = useDrop(dropTo ?? null);
  return (
    <section
      className={`${className ?? ""}${dropTo && drop.over ? " is-over" : ""}`}
      style={style}
      draggable
      onDragStart={(e) => { e.dataTransfer.setData(TYPE, JSON.stringify({ kind, id })); e.dataTransfer.effectAllowed = "move"; }}
      {...(dropTo ? drop.props : {})}
    >
      {children}
      {drop.problem && <p className="monarch-alert is-error" role="alert">{drop.problem}</p>}
    </section>
  );
}

/** A breadcrumb link that also takes drops: drop on "All pipelines" (to = null) or a parent folder to move something up. */
export function DropLink({ to, href, current, children }: { to: string | null; href: string; current?: boolean; children: React.ReactNode }) {
  const drop = useDrop(to);
  return <Link href={href} aria-current={current ? "page" : undefined} className={drop.over ? "is-over" : undefined} {...drop.props}>{children}</Link>;
}
