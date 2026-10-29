import { requireAdmin } from "@/lib/admin";
import { load, PageTitle, SetupRequired } from "@/components/admin/ui";
import { listStaff } from "@/lib/staff/server";

const ROLE_LABELS: Record<string, string> = { owner: "Owner", admin: "Admin", staff: "Staff" };

/** The people who work in this workspace. Anyone listed here can be chosen as "Assigned to" on a client. */
export default async function TeamPage() {
  await requireAdmin();
  const result = await load(() => listStaff());
  return (
    <>
      <PageTitle title="Team">The people who work in this workspace. Anyone here can be chosen as &ldquo;Assigned to&rdquo; on a client.</PageTitle>
      {!result.ok ? <SetupRequired message={result.message} /> : (
        <section className="monarch-panel">
          {result.data.length === 0 ? <p className="monarch-muted">No one else is on the team yet.</p> : (
            <div className="monarch-table-wrap">
              <table>
                <thead><tr><th>NAME</th><th>ROLE</th></tr></thead>
                <tbody>{result.data.map((p) => <tr key={p.id}><td>{p.label}</td><td>{ROLE_LABELS[p.role] ?? p.role}</td></tr>)}</tbody>
              </table>
            </div>
          )}
          <p className="monarch-muted">Adding teammates isn&apos;t available here yet.</p>
        </section>
      )}
    </>
  );
}
