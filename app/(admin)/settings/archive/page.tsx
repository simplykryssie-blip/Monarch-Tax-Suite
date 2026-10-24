import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { archiveStore } from "@/lib/archive-server";
import { ACTION_LABELS, ENTITY } from "@/lib/archive.ts";
import { ssnDeps } from "@/lib/ssn/server";
import { numberActivity } from "@/lib/ssn/service.ts";
import { workspaceRepo } from "@/lib/workspace/server";
import { EmptyRow, load, PageTitle, SetupRequired, when } from "@/components/admin/ui";

type Line = { key: string; at: string; what: string; record: React.ReactNode; kind: string; by: string; why: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The account's activity log, newest first: every record archived, restored or permanently deleted, and every time a client's
 * full Social Security number or ITIN was saved, revealed or tried. It can't be changed or deleted. `?client=` narrows it to one client.
 */
export default async function ActivityLogPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const admin = await requireAdmin();
  const sp = await searchParams;
  const only = sp.client && UUID.test(sp.client) ? sp.client : null;
  const result = await load(async () => {
    const [archive, numbers, clients] = await Promise.all([
      archiveStore().recent(200),
      numberActivity(ssnDeps(), only, 200).catch(() => []),
      workspaceRepo().listClients({ includeArchived: true }).catch(() => []),
    ]);
    return { archive, numbers, names: new Map(clients.map((c) => [c.id, c.full_name])) };
  });
  const who = (actor: string | null, auto?: boolean) => (actor ? (actor === admin.userId ? "You" : "A teammate") : auto ? "Automatic" : "—");
  const lines: Line[] = !result.ok ? [] : [
    ...result.data.archive.filter((h) => !only || h.record_id === only).map((h): Line => ({
      key: `a:${h.id}`, at: h.created_at, what: ACTION_LABELS[h.action], kind: ENTITY[h.entity].noun, by: who(h.actor_id, h.action === "auto_restored"), why: h.reason ?? "—",
      record: h.action === "deleted" ? h.label : <Link href={ENTITY[h.entity].detail(h.record_id)}>{h.label}</Link>,
    })),
    ...result.data.numbers.map((n, i): Line => ({
      key: `n:${n.clientId}:${n.at}:${i}`, at: n.at, what: n.label, kind: "Client's SSN or ITIN", by: who(n.actorId), why: "—",
      record: <Link href={`/workspace/clients/${n.clientId}`}>{result.data.names.get(n.clientId) ?? "A client"}</Link>,
    })),
  ].sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
  const clientName = only && result.ok ? result.data.names.get(only) : null;
  return (
    <>
      <PageTitle title="Activity log">
        {only ? `Everything recorded for ${clientName ?? "this client"}: archives, restores and every time their SSN or ITIN was saved or revealed. ` : "Every record archived, restored or permanently deleted, and every time a client's SSN or ITIN was saved or revealed: who, when and why. "}This log can&apos;t be changed or deleted.
      </PageTitle>
      {only && <p><Link href="/settings/archive" className="monarch-link">Show everyone&apos;s activity</Link></p>}
      {!result.ok ? (
        <SetupRequired message={result.message} />
      ) : (
        <section className="monarch-panel">
          <div className="monarch-table-wrap">
            <table>
              <thead><tr><th>WHEN</th><th>WHAT</th><th>RECORD</th><th>BY</th><th>WHY</th></tr></thead>
              <tbody>
                {lines.length === 0 ? (
                  <EmptyRow colSpan={5}>Nothing recorded yet. Archived records and client number activity show up here.</EmptyRow>
                ) : (
                  lines.map((l) => (
                    <tr key={l.key}>
                      <td>{when(l.at)}</td>
                      <td>{l.what}</td>
                      <td>{l.record}<small className="monarch-subcell">{l.kind}</small></td>
                      <td>{l.by}</td>
                      <td>{l.why}</td>
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
