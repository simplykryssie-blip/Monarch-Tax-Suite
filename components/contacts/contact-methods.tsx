import { Modal } from "@/components/ui/modal";
import { SubmitOnce } from "@/components/admin/submit-once";
import { addMethodAction, makePrimaryAction, removeMethodAction } from "@/app/(admin)/contacts/method-actions";
import { METHOD_KINDS, METHOD_LABELS, type ContactMethod, type MethodOwner } from "@/lib/contacts/methods.ts";
import { formatPhone } from "@/lib/format/ids.ts";

/** Emails and phone numbers of one person: the main ones, then the extras with their labels. */
export function ContactMethods({ owner, primary, extras, back }: { owner: MethodOwner; primary: { email: string | null; phone: string | null }; extras: ContactMethod[]; back: string }) {
  const hidden = (<><input type="hidden" name="owner_kind" value={owner.kind} /><input type="hidden" name="owner_id" value={owner.id} /><input type="hidden" name="back" value={back} /></>);
  const rows = [
    ...(primary.email ? [{ key: "pe", kind: "email" as const, label: "Main", value: primary.email, id: null as string | null }] : []),
    ...extras.filter((m) => m.kind === "email").map((m) => ({ key: m.id, kind: "email" as const, label: METHOD_LABELS[m.label], value: m.value, id: m.id as string | null })),
    ...(primary.phone ? [{ key: "pp", kind: "phone" as const, label: "Main", value: formatPhone(primary.phone), id: null as string | null }] : []),
    ...extras.filter((m) => m.kind === "phone").map((m) => ({ key: m.id, kind: "phone" as const, label: METHOD_LABELS[m.label], value: m.value, id: m.id as string | null })),
  ];
  return (
    <section className="monarch-panel cl-card">
      <div className="cl-card-head"><h2>Emails and phones</h2>
        <Modal label="Add" title="Add an email or phone" className="monarch-secondary">
          <form action={addMethodAction} className="monarch-form">
            {hidden}
            <label>Type
              <select name="kind" defaultValue="email">{Object.entries(METHOD_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </label>
            <label>Label
              <select name="label" defaultValue="personal">{Object.entries(METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </label>
            <label className="is-wide">Email or phone number<input name="value" required maxLength={254} autoComplete="off" placeholder="name@example.com or (337) 555-0100" /></label>
            <div className="is-wide ac-actions"><SubmitOnce className="monarch-primary">Add</SubmitOnce></div>
          </form>
        </Modal>
      </div>
      {rows.length === 0 ? <p className="monarch-muted cl-empty">None yet</p> : (
        <ul className="cl-list">
          {rows.map((r) => (
            <li key={r.key}>
              <span><b>{r.value}</b><small className="monarch-subcell">{METHOD_KINDS[r.kind]} · {r.label}</small></span>
              {r.id && (
                <span className="item-actions">
                  <form action={makePrimaryAction}>{hidden}<input type="hidden" name="id" value={r.id} /><button className="monarch-link" data-no-confirm>Make main</button></form>
                  <form action={removeMethodAction}>{hidden}<input type="hidden" name="id" value={r.id} /><button className="monarch-link is-danger" data-confirm={`Remove ${r.value}?`}>Remove</button></form>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
