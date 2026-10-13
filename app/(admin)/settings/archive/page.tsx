import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { archiveStore } from "@/lib/archive-server";
import { ACTION_LABELS, ENTITY } from "@/lib/archive.ts";
import { EmptyRow, load, PageTitle, SetupRequired, when } from "@/components/admin/ui";

/** Every archive, restore, automatic restore and permanent delete in this account, newest first. */
export default async function ArchiveHistoryPage() {
  const admin = await requireAdmin();
  const result = await load(() => archiveStore().recent(200));
  return (
    <>
      <PageTitle title="Archive history">Every record that was archived, restored or permanently deleted: who, when and why. This history can&apos;t be changed or deleted.</PageTitle>
      {!result.ok ? (
        <SetupRequired message={result.message} />
      ) : (
        <section className="monarch-panel">
          <div className="monarch-table-wrap">
            <table>
              <thead><tr><th>WHEN</th><th>WHAT</th><th>RECORD</th><th>BY</th><th>WHY</th></tr></thead>
              <tbody>
                {result.data.length === 0 ? (
                  <EmptyRow colSpan={5}>Nothing archived yet. Remove buttons archive records; they show up here.</EmptyRow>
                ) : (
                  result.data.map((h) => (
                    <tr key={h.id}>
                      <td>{when(h.created_at)}</td>
                      <td>{ACTION_LABELS[h.action]}</td>
                      <td>{h.action === "deleted" ? h.label : <Link href={ENTITY[h.entity].detail(h.record_id)}>{h.label}</Link>}<small className="monarch-subcell">{ENTITY[h.entity].noun}</small></td>
                      <td>{h.actor_id ? (h.actor_id === admin.userId ? "You" : "An administrator") : h.action === "auto_restored" ? "Automatic" : "—"}</td>
                      <td>{h.reason ?? "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
