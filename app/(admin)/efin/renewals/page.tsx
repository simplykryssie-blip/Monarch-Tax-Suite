import { ActionForm } from "../action-form";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { Badge, EmptyRow, Flash, load, PageTitle, SetupRequired } from "@/components/admin/ui";
import { complianceExceptions, EXCEPTION_LABEL, groupExceptions, uniqueBy } from "@/lib/efin/exceptions.ts";
import { daysUntil, todayIso } from "@/lib/efin/rules.ts";
import { loadSnapshot } from "@/lib/efin/service";
import { completeRenewalAction } from "../actions";

export default async function Renewals({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const result = await load(loadSnapshot);
  const today = todayIso();
  return (
    <>
      <PageTitle title="Renewals & compliance">Reminders run daily at 60, 30, 14 and 7 days before a verified renewal date, once per person per stage. A missed date opens a compliance review; nothing is invalidated automatically.</PageTitle>
      <Flash {...sp} />
      {!result.ok ? <SetupRequired message={result.message} module="efin" /> : (() => {
        const s = result.data;
        const open = uniqueBy(s.tasks.filter((t) => ["open", "urgent", "escalated", "overdue"].includes(t.status)), (t) => `${t.subject_id}|${t.title}|${t.due_on}`);
        const exceptions = groupExceptions(complianceExceptions({ ...s, today }));
        return (
          <>
            <section className="monarch-panel">
              <div className="monarch-panel-head"><div><h2>Renewal tasks</h2><p>These appear here whether or not any email was delivered.</p></div></div>
              <div className="monarch-table-wrap"><table>
                <thead><tr><th>TASK</th><th>DUE</th><th>DAYS</th><th>STATUS</th><th>COMPLETE (WITH EVIDENCE)</th></tr></thead>
                <tbody>{open.length === 0 ? <EmptyRow colSpan={5}>No open renewals. Tasks are created from verified renewal dates on your EFINs.</EmptyRow> : open.map((t) => (
                  <tr key={t.id}>
                    <td><Link href={`/efin/${t.subject_id}?tab=filing#renewals`}><b>{t.title}</b></Link></td><td>{t.due_on}{t.due_on !== t.original_due_on && <small className="monarch-muted"> (was {t.original_due_on})</small>}</td>
                    <td>{daysUntil(t.due_on, today)}</td><td><Badge value={t.status} /></td>
                    <td>
                      <ActionForm action={completeRenewalAction} className="efin-actions">
                        <input type="hidden" name="id" value={t.id} />
                        <input type="date" name="new_due_on" required aria-label="New verified expiration date" />
                        <input type="text" name="evidence_note" required minLength={5} maxLength={1000} placeholder="What confirmed it" aria-label="Evidence" />
                        <button className="monarch-secondary efin-small" type="submit">Record renewal</button>
                      </ActionForm>
                    </td>
                  </tr>
                ))}</tbody>
              </table></div>
            </section>
            <section className="monarch-panel" id="exceptions">
              <div className="monarch-panel-head"><div><h2>Compliance exceptions</h2><p>Gaps in what is recorded. Resolve them by verifying and recording the missing information.</p></div></div>
              <div className="monarch-table-wrap"><table>
                <thead><tr><th>ITEM</th><th>ISSUE</th><th>DETAIL</th></tr></thead>
                <tbody>{exceptions.length === 0 ? <EmptyRow colSpan={3}>No exceptions. Everything recorded is verified and current.</EmptyRow> : exceptions.map((g) => (
                  <tr key={g.key}>
                    <td><span className={"efin-sev " + g.severity} /><Link href={g.href}><b>{g.title}</b></Link></td>
                    <td>{g.issues.map((x) => <div key={x.kind}>{EXCEPTION_LABEL[x.kind]}</div>)}</td>
                    <td style={{ whiteSpace: "normal", maxWidth: 520 }}>{g.issues.map((x) => <div key={x.kind}>{x.detail}</div>)}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            </section>
          </>
        );
      })()}
    </>
  );
}
