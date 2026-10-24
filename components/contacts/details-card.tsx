"use client";

import { useState } from "react";
import { ActionForm } from "@/app/(admin)/efin/action-form";
import { saveClientDetailsAction } from "@/app/(admin)/workspace/actions";
import { FormattedInput } from "@/components/forms/formatted-input";
import { StateSelect } from "@/components/forms/state-select";
import { RevealSsn } from "@/components/workspace/reveal-ssn";

export type Details = {
  id: string; first_name: string; last_name: string; email: string; phone: string; dob: string; ssn_last4: string | null; ssn_on_file: boolean;
  address_line1: string; address_line2: string; city: string; state: string; zip: string; address: string;
  same_address: boolean; prior_address_line1: string; prior_address_line2: string; prior_city: string; prior_state: string; prior_zip: string;
  dl_number: string; dl_state: string; dl_issued_on: string; dl_expires_on: string;
};

const us = (iso: string) => (iso ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}` : "");
const place = (line1: string, line2: string, city: string, state: string, zip: string) => [[line1, line2].filter(Boolean).join(", "), [city, [state, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")].filter(Boolean).join(", ");

/**
 * The client's details. They are read-only until Edit is pressed, so nothing is changed by accident; the same button becomes Save,
 * and after saving the page confirms what was updated.
 */
export function DetailsCard({ d }: { d: Details }) {
  const [editing, setEditing] = useState(false);
  const [same, setSame] = useState(d.same_address);

  if (!editing) {
    const address = place(d.address_line1, d.address_line2, d.city, d.state, d.zip) || d.address;
    const prior = d.same_address ? "Same as the current address" : place(d.prior_address_line1, d.prior_address_line2, d.prior_city, d.prior_state, d.prior_zip) || "Different (not entered)";
    const license = [d.dl_number, d.dl_state, d.dl_issued_on ? `issued ${us(d.dl_issued_on)}` : "", d.dl_expires_on ? `expires ${us(d.dl_expires_on)}` : ""].filter(Boolean).join(" · ");
    return (
      <section className="monarch-panel cl-card dc-card">
        <div className="cl-card-head"><h2>Details</h2><button type="button" className="monarch-secondary" onClick={() => setEditing(true)}>Edit</button></div>
        <dl className="dc-list">
          <div><dt>Name</dt><dd>{[d.first_name, d.last_name].filter(Boolean).join(" ")}</dd></div>
          <div><dt>Email</dt><dd>{d.email || "—"}</dd></div>
          <div><dt>Phone</dt><dd>{d.phone || "—"}</dd></div>
          <div><dt>Date of birth</dt><dd>{us(d.dob) || "—"}</dd></div>
          <div><dt>SSN or ITIN</dt><dd>{d.ssn_on_file || d.ssn_last4 ? <RevealSsn clientId={d.id} last4={d.ssn_last4} onFile={d.ssn_on_file} editable={false} /> : "—"}</dd></div>
          <div><dt>Address</dt><dd>{address || "—"}</dd></div>
          <div><dt>Last year&apos;s return</dt><dd>{prior}</dd></div>
          <div><dt>Driver&apos;s license</dt><dd>{license || "—"}</dd></div>
        </dl>
      </section>
    );
  }

  return (
    <ActionForm action={saveClientDetailsAction} className="monarch-panel monarch-form cl-card dc-card">
      <div className="cl-card-head is-wide"><h2>Details</h2>
        <span className="cl-card-actions"><button type="button" className="monarch-secondary" onClick={() => setEditing(false)}>Cancel</button><button className="monarch-primary">Save</button></span>
      </div>
      <input type="hidden" name="id" value={d.id} />
      <input type="hidden" name="ssn_last4" value={d.ssn_last4 ?? ""} />
      <label>First name *<input name="first_name" required maxLength={100} defaultValue={d.first_name} /></label>
      <label>Last name *<input name="last_name" required maxLength={100} defaultValue={d.last_name} /></label>
      <label>Email<input name="email" type="email" maxLength={254} defaultValue={d.email} /></label>
      <label>Phone<FormattedInput kind="phone" name="phone" defaultValue={d.phone} /></label>
      <label>Date of birth<input name="dob" type="date" defaultValue={d.dob} /></label>
      <div className="is-wide"><span>Social Security number or ITIN</span><RevealSsn clientId={d.id} last4={d.ssn_last4} onFile={d.ssn_on_file} /></div>
      <label className="is-wide">Street address<input name="address_line1" maxLength={150} defaultValue={d.address_line1 || (d.city || d.state || d.zip ? "" : d.address)} /></label>
      <label className="is-wide">Apt, suite or unit<input name="address_line2" maxLength={100} defaultValue={d.address_line2} /></label>
      <label>City<input name="city" maxLength={80} defaultValue={d.city} /></label>
      <label>State<StateSelect name="state" defaultValue={d.state} /></label>
      <label>ZIP<FormattedInput kind="zip" name="zip" defaultValue={d.zip} /></label>

      <fieldset className="is-wide dc-same">
        <legend>This address was used on last year&apos;s return</legend>
        <label className="monarch-check"><input type="radio" name="same_address" value="yes" checked={same} onChange={() => setSame(true)} /> Yes</label>
        <label className="monarch-check"><input type="radio" name="same_address" value="no" checked={!same} onChange={() => setSame(false)} /> No</label>
      </fieldset>
      {!same && (
        <>
          <label className="is-wide">Address on last year&apos;s return<input name="prior_address_line1" maxLength={150} defaultValue={d.prior_address_line1} placeholder="Street address" /></label>
          <label className="is-wide">Apt, suite or unit<input name="prior_address_line2" maxLength={100} defaultValue={d.prior_address_line2} /></label>
          <label>City<input name="prior_city" maxLength={80} defaultValue={d.prior_city} /></label>
          <label>State<StateSelect name="prior_state" defaultValue={d.prior_state} /></label>
          <label>ZIP<FormattedInput kind="zip" name="prior_zip" defaultValue={d.prior_zip} /></label>
        </>
      )}

      <h3 className="is-wide dc-sub">Driver&apos;s license</h3>
      <label>License number<input name="dl_number" maxLength={40} defaultValue={d.dl_number} autoComplete="off" /></label>
      <label>State issued<StateSelect name="dl_state" defaultValue={d.dl_state} label="State that issued the license" /></label>
      <label>Issue date<input name="dl_issued_on" type="date" defaultValue={d.dl_issued_on} /></label>
      <label>Expiration date<input name="dl_expires_on" type="date" defaultValue={d.dl_expires_on} /></label>
    </ActionForm>
  );
}
