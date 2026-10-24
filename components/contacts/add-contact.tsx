"use client";

import { useState } from "react";
import { ActionForm } from "@/app/(admin)/efin/action-form";
import { addContactAction } from "@/app/(admin)/workspace/actions";
import { FormattedInput } from "@/components/forms/formatted-input";
import { Modal } from "@/components/ui/modal";
import type { NewContactKind } from "@/lib/contacts/kinds.ts";

const LABEL: Record<NewContactKind, string> = { client: "Client", lead: "Lead", customer: "Customer" };

/** The one Add button: pick Client, Lead or Customer, fill in what that kind needs, and land on the new contact. */
export function AddContact({ kinds, className = "monarch-primary" }: { kinds: NewContactKind[]; className?: string }) {
  return (
    <Modal label="Add" title="Add a contact" className={className}>
      <AddForm kinds={kinds} />
    </Modal>
  );
}

function AddForm({ kinds }: { kinds: NewContactKind[] }) {
  const [kind, setKind] = useState<NewContactKind>(kinds[0]);
  const needsEmail = kind !== "client";
  return (
    <ActionForm action={addContactAction} className="monarch-form">
      <input type="hidden" name="kind" value={kind} />
      {kinds.length > 1 && (
        <div className="is-wide ac-kinds" role="group" aria-label="Kind of contact">
          {kinds.map((k) => <button key={k} type="button" aria-pressed={kind === k} className={kind === k ? "is-on" : undefined} onClick={() => setKind(k)}>{LABEL[k]}</button>)}
        </div>
      )}
      <label>First name *<input name="first_name" required maxLength={100} autoComplete="off" /></label>
      <label>Last name *<input name="last_name" required maxLength={100} autoComplete="off" /></label>
      <label>Email{needsEmail ? " *" : ""}<input name="email" type="email" required={needsEmail} maxLength={254} autoComplete="off" /></label>
      <label>Phone<FormattedInput kind="phone" name="phone" autoComplete="off" /></label>
      {kind === "client" && (
        <>
          <label>Date of birth<input name="dob" type="date" /></label>
          <label>Social Security number or ITIN<FormattedInput kind="ssn" name="ssn" secret autoComplete="off" placeholder="Nine digits" /></label>
        </>
      )}
      <div className="is-wide ac-actions"><button className="monarch-primary">Add {LABEL[kind].toLowerCase()}</button></div>
    </ActionForm>
  );
}
