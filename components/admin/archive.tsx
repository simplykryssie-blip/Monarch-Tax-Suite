import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { ACTION_LABELS, archiveProblem, confirmText, ENTITY, moneyTaken, type ArchiveEntity, type ArchiveView, type OrderMoney } from "@/lib/archive.ts";
import { archiveStore } from "@/lib/archive-server";
import { archiveRecordAction, hardDeleteRecordAction, restoreRecordAction } from "@/app/(admin)/archive-actions";
import { when } from "./ui";

// The archive pieces every admin list and detail page shares, so they all look and behave the same.

/** "Current / Archived" tabs over a list. `base` is the list's path; other query parameters can be kept with `keep`. */
export function ArchiveTabs({ base, view, counts, keep = {} }: { base: string; view: ArchiveView; counts: { current: number; archived: number }; keep?: Record<string, string | undefined> }) {
  const href = (v: ArchiveView) => {
    const p = new URLSearchParams(Object.entries(keep).filter((e): e is [string, string] => !!e[1]));
    if (v === "archived") p.set("view", "archived");
    const q = p.toString();
    return q ? `${base}?${q}` : base;
  };
  return (
    <nav className="mf-tabs" aria-label="Current or archived" style={{ marginBottom: 12 }}>
      <Link href={href("current")} className={view === "current" ? "is-active" : undefined} aria-current={view === "current" ? "page" : undefined}>Current ({counts.current})</Link>
      <Link href={href("archived")} className={view === "archived" ? "is-active" : undefined} aria-current={view === "archived" ? "page" : undefined}>Archived ({counts.archived})</Link>
    </nav>
  );
}

const Hidden = ({ entity, id, back }: { entity: ArchiveEntity; id: string; back: string }) => (
  <>
    <input type="hidden" name="entity" value={entity} />
    <input type="hidden" name="id" value={id} />
    <input type="hidden" name="back" value={back} />
  </>
);

/** A list row's button: Restore on the Archived tab, Remove (archive) on the Current tab when the list allows it. */
export function ArchiveRowButton({ entity, id, archived, back }: { entity: ArchiveEntity; id: string; archived: boolean; back: string }) {
  return (
    <form action={archived ? restoreRecordAction : archiveRecordAction} style={{ display: "inline" }}>
      <Hidden entity={entity} id={id} back={back} />
      <button className="monarch-secondary" style={{ padding: "4px 10px" }}>{archived ? "Restore" : "Remove"}</button>
    </form>
  );
}

/**
 * The archive section of a detail page: Remove (archive) with an optional reason; once archived, Restore, and for the
 * account owner a permanent delete that needs the record's email or number typed. Also lists the record's history.
 */
export async function ArchivePanel({ entity, id, back }: { entity: ArchiveEntity; id: string; back?: string }) {
  const admin = await requireAdmin();
  const store = archiveStore();
  const data = await (async () => {
    try {
      const row = await store.get(entity, id);
      if (!row) return null;
      const [facts, history, isOwner] = await Promise.all([store.facts(entity, row), store.history(entity, id), store.isOwner(admin.userId)]);
      return { row, facts, history, isOwner };
    } catch {
      return "missing" as const;
    }
  })();
  if (data === "missing") return <section className="monarch-panel" style={{ padding: 20 }}><h2>Archive</h2><p className="monarch-muted">Archiving is not installed yet. Apply the archive migration first.</p></section>;
  if (!data) return null;
  const { row, facts, history, isOwner } = data;
  const noun = ENTITY[entity].noun;
  const here = back ?? ENTITY[entity].detail(id) ?? ENTITY[entity].list;
  const blocked = archiveProblem(entity, row, facts);
  const kept = (entity === "order" && moneyTaken(row as unknown as OrderMoney)) || (entity === "customer" && (facts.orders ?? []).some(moneyTaken));
  return (
    <section className="monarch-panel" style={{ padding: 20 }}>
      {row.archived_at ? (
        <>
          <h2>Archived</h2>
          <p>This {noun} was archived {when(row.archived_at)}{row.archive_reason ? `: ${row.archive_reason}` : "."} It&apos;s hidden from the list but nothing about it has changed.</p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <form action={restoreRecordAction}><Hidden entity={entity} id={id} back={here} /><button className="monarch-primary">Restore</button></form>
            {isOwner && !kept && (
              <form action={hardDeleteRecordAction} className="monarch-inline-form">
                <Hidden entity={entity} id={id} back={here} />
                <label className="monarch-muted" style={{ display: "grid", gap: 4 }}>To delete it permanently, type {ENTITY[entity].confirmWhat}:
                  <input name="confirm" required placeholder={confirmText(entity, row, facts)} autoComplete="off" />
                </label>
                <button className="monarch-secondary is-danger">Delete permanently</button>
              </form>
            )}
          </div>
          {kept && <p className="monarch-muted">This is a financial record (an order that took money), so it can&apos;t be permanently deleted. It stays archived.</p>}
          {!isOwner && <p className="monarch-muted">Only the account owner can delete archived records permanently.</p>}
        </>
      ) : (
        <>
          <h2>Remove</h2>
          <p className="monarch-muted">Removing archives the {noun}: it&apos;s hidden from the list, keeps all its links and history, and can be restored at any time.</p>
          {blocked ? (
            <p className="monarch-alert is-error">{blocked}</p>
          ) : (
            <form action={archiveRecordAction} className="monarch-inline-form">
              <Hidden entity={entity} id={id} back={here} />
              <input name="reason" maxLength={500} placeholder="Why (optional), for example: test record" aria-label="Reason for archiving" />
              <button className="monarch-secondary">Remove (archive)</button>
            </form>
          )}
        </>
      )}
      {history.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary className="monarch-muted">Archive history ({history.length})</summary>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
            {history.map((h) => <li key={h.id}>{ACTION_LABELS[h.action]} · {when(h.created_at)}{h.actor_id ? (h.actor_id === admin.userId ? " · by you" : " · by an administrator") : h.action === "auto_restored" ? " · automatically" : ""}{h.reason ? ` · ${h.reason}` : ""}</li>)}
          </ul>
        </details>
      )}
    </section>
  );
}
