import { requireAdmin } from "@/lib/admin";
import { EmptyRow, Flash, load, PageTitle, SetupRequired } from "@/components/admin/ui";
import { loadSnapshot } from "@/lib/efin/service";
import { ActionForm } from "../../efin/action-form";
import { addOptionAction, removeOptionAction, toggleOptionAction } from "../../efin/actions";
import type { OptionRow } from "@/lib/efin/types";

const LISTS: { kind: OptionRow["kind"]; title: string; blurb: string; placeholder: string }[] = [
  { kind: "tax_software", title: "Tax software", blurb: "The tax preparation software you support. Firms pick from this list when you add them.", placeholder: "e.g. Drake Tax" },
  { kind: "bank_product", title: "Bank products", blurb: "The refund-transfer and bank product providers you offer. Firms pick from this list when you add them.", placeholder: "e.g. your bank partner's name" },
];

export default async function Settings({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const result = await load(loadSnapshot);
  return (
    <>
      <PageTitle title="Settings">The lists your team picks from when adding a firm. Nothing here is shared outside Monarch.</PageTitle>
      <Flash {...sp} />
      {!result.ok ? <SetupRequired message={result.message} module="efin" /> : (
        <div className="efin-flow">
          {LISTS.map((l) => {
            const items = result.data.options.filter((o) => o.kind === l.kind);
            const used = (id: string) => result.data.orgOptions.filter((x) => x.option_id === id).length;
            return (
              <section className="monarch-panel" key={l.kind}>
                <div className="monarch-panel-head"><div><h2>{l.title}</h2><p>{l.blurb}</p></div></div>
                <div className="monarch-table-wrap"><table>
                  <thead><tr><th>NAME</th><th>FIRMS USING IT</th><th>STATUS</th><th></th></tr></thead>
                  <tbody>
                    {items.length === 0 ? <EmptyRow colSpan={4}>Nothing on this list yet. Add the first one below.</EmptyRow> : items.map((o) => (
                      <tr key={o.id}>
                        <td><b>{o.name}</b>{o.notes && <div className="monarch-muted">{o.notes}</div>}</td>
                        <td>{used(o.id)}</td>
                        <td>{o.active ? "Shown" : <span className="monarch-muted">Hidden</span>}</td>
                        <td>
                          <div className="efin-actions" style={{ justifyContent: "flex-end" }}>
                            <ActionForm action={toggleOptionAction}>
                              <input type="hidden" name="id" value={o.id} /><input type="hidden" name="active" value={o.active ? "no" : "yes"} />
                              <button className="monarch-secondary efin-small" type="submit">{o.active ? "Hide" : "Show"}</button>
                            </ActionForm>
                            <ActionForm action={removeOptionAction} confirm={`Remove ${o.name} from your list?`}>
                              <input type="hidden" name="id" value={o.id} /><input type="hidden" name="confirm" value="on" />
                              <button className="monarch-secondary is-danger efin-small" type="submit">Remove</button>
                            </ActionForm>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
                <ActionForm action={addOptionAction} className="efin-actions" >
                  <input type="hidden" name="kind" value={l.kind} />
                  <input type="text" name="name" required maxLength={120} placeholder={l.placeholder} aria-label={`Add to ${l.title}`} style={{ minWidth: 280 }} />
                  <button className="monarch-primary efin-small" type="submit">Add</button>
                </ActionForm>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
