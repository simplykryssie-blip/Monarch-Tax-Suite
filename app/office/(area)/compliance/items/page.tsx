import { EmptyRow, Flash } from "@/components/admin/ui";
import { ActionForm } from "@/app/(admin)/efin/action-form";
import { itemState, todayIso } from "@/lib/compliance/rules.ts";
import { createItemAction, deleteItemAction, itemDoneAction } from "../actions";
import { ComplianceTabs, compliancePage, day, loadOr, SetupNotice, stamp } from "../parts";

const LABEL = { done: "Done", open: "Open", due_soon: "Due soon", overdue: "Overdue" } as const;

/** The office's own compliance checklist, alongside the IRS and FTC items the Compliance Center tracks. */
export default async function Items({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const { ctx, deps, may } = await compliancePage("compliance.manage");
  const sp = await searchParams;
  const result = await loadOr(() => deps.repo.listItems(ctx.officeId));
  const today = todayIso();
  return (
    <>
      <h1 className="office-h1">Office checklist</h1>
      <ComplianceTabs may={may} active="/office/compliance/items" />
      <Flash notice={sp.notice} error={sp.error} />
      {!result.ok ? <SetupNotice message={result.message} /> : (
        <>
          <section className="monarch-panel">
            <div className="monarch-panel-head"><div><h2>Your items</h2><p>Anything your office checks for itself: shredding days, insurance renewals, security training, software reviews.</p></div></div>
            <div className="monarch-table-wrap"><table>
              <thead><tr><th>ITEM</th><th>DUE</th><th>STATUS</th><th></th></tr></thead>
              <tbody>{result.data.length === 0 ? <EmptyRow colSpan={4}>No items yet. Add your first one below.</EmptyRow> : result.data.map((i) => {
                const st = itemState(i, today);
                return (
                  <tr key={i.id}>
                    <td><b>{i.title}</b><small className="monarch-subcell">{i.description ?? ""}{i.repeat === "yearly" ? " · Every year" : ""}</small></td>
                    <td>{day(i.due_on)}</td>
                    <td className={`compliance-${st.state}`}>{LABEL[st.state]}{i.done_at && <small className="monarch-subcell">Last done by {i.done_by_name}, {stamp(i.done_at)}</small>}</td>
                    <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <ActionForm action={itemDoneAction}><input type="hidden" name="id" value={i.id} /><input type="hidden" name="done" value={st.state === "done" ? "no" : "yes"} /><button className="monarch-secondary efin-small">{st.state === "done" ? "Mark not done" : "Mark done"}</button></ActionForm>
                      <ActionForm action={deleteItemAction} confirm={`Remove "${i.title}" from the checklist?`}><input type="hidden" name="id" value={i.id} /><button className="monarch-secondary is-danger efin-small">Remove</button></ActionForm>
                    </td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          </section>
          <section className="monarch-panel" style={{ padding: 20 }}>
            <h2 style={{ marginTop: 0 }}>Add an item</h2>
            <ActionForm action={createItemAction} className="monarch-form compliance-form">
              <label>Title *<input name="title" required maxLength={200} /></label>
              <label>Due date<input name="due_on" type="date" /></label>
              <label>Repeats<select name="repeat" defaultValue="once"><option value="once">One time</option><option value="yearly">Every year</option></select></label>
              <label className="is-wide">Description<textarea name="description" rows={2} maxLength={2000} /></label>
              <div className="is-wide"><button className="monarch-primary">Add item</button></div>
            </ActionForm>
          </section>
        </>
      )}
    </>
  );
}
