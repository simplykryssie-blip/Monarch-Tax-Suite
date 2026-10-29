import Link from "next/link";
import { Modal } from "@/components/ui/modal";
import { SubmitOnce } from "@/components/admin/submit-once";
import { PersonPicker } from "@/components/contacts/person-picker";
import { addRelationshipAction, removeRelationshipAction } from "@/app/(admin)/contacts/relationship-actions";
import { REL_KINDS, type PersonRef, type RelationshipView } from "@/lib/contacts/relationships.ts";

export type LegacyLine = { label: string; text: string };

/** A person's family: the relationships added here, plus the spouse and dependents recorded in their own sections (read-only, listed for the whole picture). */
export function RelationshipsCard({ me, items, legacy = [], back }: { me: PersonRef; items: RelationshipView[]; legacy?: LegacyLine[]; back: string }) {
  const hidden = (<><input type="hidden" name="owner_kind" value={me.kind} /><input type="hidden" name="owner_id" value={me.id} /><input type="hidden" name="back" value={back} /></>);
  const href = (p: PersonRef) => (p.kind === "client" ? `/workspace/clients/${p.id}` : `/contacts/lead-${p.id}`);
  return (
    <section className="monarch-panel cl-card">
      <div className="cl-card-head"><h2>Relationships</h2>
        <Modal label="Add" title="Add a relationship" className="monarch-secondary">
          <form action={addRelationshipAction} className="monarch-form">
            {hidden}
            <PersonPicker excludeId={me.id} />
            <label>They are this person&apos;s
              <select name="kind" defaultValue="spouse">{Object.entries(REL_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </label>
            <label>Note (needed for Other)<input name="note" maxLength={200} autoComplete="off" placeholder="For example: guardian" /></label>
            <div className="is-wide ac-actions"><SubmitOnce className="monarch-primary">Add relationship</SubmitOnce></div>
          </form>
        </Modal>
      </div>
      {items.length + legacy.length === 0 ? <p className="monarch-muted cl-empty">None yet</p> : (
        <ul className="cl-list">
          {items.map((r) => (
            <li key={r.id}>
              <span><b>{r.label}</b>: <Link href={href(r.other)}>{r.otherName}</Link>{r.note ? <small className="monarch-subcell">{r.note}</small> : null}</span>
              <form action={removeRelationshipAction}>{hidden}<input type="hidden" name="id" value={r.id} /><button className="monarch-link is-danger" data-confirm={`Remove this relationship with ${r.otherName}?`}>Remove</button></form>
            </li>
          ))}
          {legacy.map((l, i) => <li key={`legacy-${i}`}><span><b>{l.label}</b>: {l.text}<small className="monarch-subcell">Kept in its own section below</small></span></li>)}
        </ul>
      )}
    </section>
  );
}
