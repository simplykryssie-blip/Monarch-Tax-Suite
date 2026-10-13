import { requireAdmin } from "@/lib/admin";
import { automationDeps } from "@/lib/automation/server";
import { Flash, load, PageTitle, SetupRequired } from "@/components/admin/ui";
import { deleteAttributeAction, saveAttributeAction } from "../actions";

export default async function PackageAttributesPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireAdmin();
  const { notice, error } = await searchParams;
  const result = await load(() => automationDeps().senders!.listPackageAttributes());
  return (
    <>
      <PageTitle title="Package attributes">Your own labels for products and packages, for example a flow type or whether mentoring is included. Set the value on each product (Product settings: <code>key: value</code>), then use it in workflow conditions to send the right documents for each package.</PageTitle>
      <Flash notice={notice} error={error} />
      {!result.ok ? <SetupRequired message={result.message} /> : (
        <>
          <section className="monarch-panel">
            <div className="monarch-table-wrap"><table>
              <thead><tr><th>KEY</th><th>LABEL</th><th>KIND</th><th>OPTIONS</th><th></th></tr></thead>
              <tbody>
                {result.data.length === 0 ? <tr><td colSpan={5} className="monarch-empty">No attributes yet.</td></tr> : result.data.map((a) => (
                  <tr key={a.id}>
                    <td><code>{a.key}</code></td>
                    <td colSpan={3}>
                      <form action={saveAttributeAction} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <input type="hidden" name="id" value={a.id} /><input type="hidden" name="key" value={a.key} />
                        <input name="label" defaultValue={a.label} maxLength={80} aria-label="Label" />
                        <select name="kind" defaultValue={a.kind} aria-label="Kind"><option value="choice">Choice</option><option value="text">Free text</option></select>
                        <input name="options" defaultValue={a.options.join(", ")} placeholder="option one, option two" aria-label="Options" />
                        <button className="monarch-secondary">Save</button>
                      </form>
                    </td>
                    <td><form action={deleteAttributeAction}><input type="hidden" name="id" value={a.id} /><button className="monarch-secondary is-danger">Remove</button></form></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </section>
          <form action={saveAttributeAction} className="monarch-panel monarch-form" style={{ padding: 20 }}>
            <h2 className="is-wide">Add an attribute</h2>
            <label>Key<input name="key" required maxLength={40} placeholder="flow_type" /></label>
            <label>Label<input name="label" required maxLength={80} placeholder="Flow type" /></label>
            <label>Kind<select name="kind" defaultValue="choice"><option value="choice">Choice (fixed options)</option><option value="text">Free text</option></select></label>
            <label className="is-wide">Options (for a choice, separated by commas)<input name="options" placeholder="ptin_holder, standard_ero" /></label>
            <div className="is-wide"><button className="monarch-primary">Add attribute</button></div>
          </form>
        </>
      )}
    </>
  );
}
