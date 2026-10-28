import { Modal } from "@/components/ui/modal";
import { MergeChoice } from "@/components/contacts/merge-choice";
import { mergeContactsAction } from "@/app/(admin)/contacts/merge-actions";
import { nameKey, normalizeEmail, normalizePhone, type Contact } from "@/lib/contacts/combine.ts";
import { mergePlan } from "@/lib/contacts/merge-plan.ts";

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "No activity yet");

type Row = { label: string; a: string; b: string; same: boolean };

function rowsOf(a: Contact, b: Contact): Row[] {
  const eq = (x: string | null, y: string | null) => x !== null && x === y;
  return [
    { label: "Name", a: a.name, b: b.name, same: eq(nameKey(a.name), nameKey(b.name)) },
    { label: "Email", a: a.email ?? "none", b: b.email ?? "none", same: eq(normalizeEmail(a.email), normalizeEmail(b.email)) },
    { label: "Phone", a: a.phone ?? "none", b: b.phone ?? "none", same: eq(normalizePhone(a.phone), normalizePhone(b.phone)) },
    { label: "Is a", a: a.chips.map((c) => c.label).join(", ") || "—", b: b.chips.map((c) => c.label).join(", ") || "—", same: false },
    { label: "Tags", a: a.tags.join(", ") || "none", b: b.tags.join(", ") || "none", same: false },
    { label: "Last activity", a: day(a.lastActivity), b: day(b.lastActivity), same: false },
  ];
}

/** Two possible duplicates side by side: what matches is marked, what differs is plain, so a person can tell if it is the same person. */
export function DuplicateCompare({ a, b, reason, back = "/contacts", openA, openB }: { a: Contact; b: Contact; reason: string; back?: string; openA: string; openB: string }) {
  const plan = mergePlan(a, b);
  return (
    <div className="dup-card">
      <p className="dup-why">{reason}</p>
      <table className="dup-table">
        <thead>
          <tr><th /><th><a href={openA} target="_blank" rel="noreferrer">{a.name}</a></th><th><a href={openB} target="_blank" rel="noreferrer">{b.name}</a></th></tr>
        </thead>
        <tbody>
          {rowsOf(a, b).map((r) => (
            <tr key={r.label} className={r.same ? "is-match" : undefined}>
              <th scope="row">{r.label}</th>
              <td>{r.a}</td>
              <td>{r.b}{r.same && <small className="dup-same"> ✓ same</small>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="dup-actions">
        {plan ? (
          <Modal label="Merge these two" title={`Merge ${a.name} and ${b.name}`} className="monarch-primary">
            <form action={mergeContactsAction} className="monarch-form">
              <input type="hidden" name="kind" value={plan.kind} />
              <input type="hidden" name="back" value={back} />
              {plan.kind === "lead_into_client" ? (
                <>
                  <input type="hidden" name="keep" value={plan.clientId} /><input type="hidden" name="drop" value={plan.leadId} />
                  <p className="is-wide">Keep the client and fold the lead into it. The lead&apos;s details become a note on the client and the lead is marked converted.</p>
                </>
              ) : (
                <>
                  <MergeChoice thisId={plan.a} thisName={a.name} otherId={plan.b} otherName={b.name} />
                  <p className="is-wide monarch-muted">{plan.kind === "clients" ? "The other record's details, returns, invoices and notes move onto the one you keep, and it is archived." : "The other lead's details are added to the notes of the one you keep, and it is marked Lost."}</p>
                </>
              )}
              <div className="is-wide ac-actions"><button className="monarch-primary">Merge</button></div>
            </form>
          </Modal>
        ) : (
          <small className="monarch-muted">Store customers have orders and licenses, so they can&apos;t be merged here. Open each one to compare.</small>
        )}
      </div>
    </div>
  );
}
