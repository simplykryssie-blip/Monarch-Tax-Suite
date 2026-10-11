"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { onboardEroAction, type FormResult } from "./actions";
import { FormattedInput } from "./formatted-input";
import { displayAddress, displayPhone, formatCity, formatStreet } from "@/lib/efin/format.ts";
import { STRUCTURE_OPTIONS, structureLabel } from "@/lib/efin/text.ts";

const STEPS = ["Firm", "Locations", "Contact", "EFIN", "Software", "Review"] as const;
type Opt = { id: string; kind: "tax_software" | "bank_product"; name: string };
const CONFIRM = [
  { value: "unverified", label: "Unconfirmed" },
  { value: "pending", label: "Pending confirmation" },
  { value: "verified", label: "Confirmed" },
];
const confirmLabel = (v: string | undefined) => CONFIRM.find((c) => c.value === v)?.label ?? "Unconfirmed";
const RELATIONSHIPS = [
  { value: "client", title: "Software / service client", note: "They bought software or services from me. I keep their firm, locations, contact and EFIN only: no team or PTINs." },
  { value: "partner", title: "Partner", note: "I may manage some of their preparers." },
  { value: "internal", title: "My own tax office", note: "I manage its preparers and PTINs." },
  { value: "other", title: "Other", note: "Anything else." },
];
// Which step each server-reported field lives on, so an error jumps back to the right place.
const stepOf = (field: string) =>
  /^(relationship|legal_name|dba_name|business_structure|ein)$/.test(field) ? 0
  : /^(office_name|line1|city|state|zip|extra_)/.test(field) ? 1
  : /^(person_|resp_|ptin)/.test(field) ? 2
  : /^option/.test(field) ? 4
  : 3;

type Values = Record<string, string>;

export function OnboardingWizard({ options }: { options: Opt[] }) {
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [relationship, setRelationship] = useState("client");
  const [sameResponsible, setSameResponsible] = useState(true);
  const [extra, setExtra] = useState(0);
  const [review, setReview] = useState<Values>({});
  const [chosen, setChosen] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const form = useRef<HTMLFormElement>(null);
  const team = relationship !== "client";
  const last = STEPS.length - 1;

  const read = (): Values => {
    const data = new FormData(form.current!);
    const out: Values = {};
    for (const [k, v] of data.entries()) if (typeof v === "string" && k !== "option_ids") out[k] = v;
    return out;
  };
  const mark = (name: string) => {
    form.current?.querySelectorAll("[aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
    const el = form.current?.querySelector<HTMLElement>(`[name="${CSS.escape(name)}"]`);
    if (el) { el.setAttribute("aria-invalid", "true"); requestAnimationFrame(() => el.focus()); }
  };
  const need = (name: string, message: string): boolean => {
    const v = read()[name]?.trim() ?? "";
    const bad = name === "efin" ? v.replace(/\D/g, "").length !== 6 : !v;
    if (bad) { setError(message); mark(name); }
    return !bad;
  };
  const go = (to: number) => { setError(null); if (to === last) setReview(read()); setStep(to); };
  const next = () => {
    setError(null);
    if (step === 0 && !need("legal_name", "Enter the firm's legal name.")) return;
    if (step === 2 && !need("person_name", "Enter the ERO's name.")) return;
    if (step === 2 && !sameResponsible && !need("resp_name", "Enter the responsible party's name, or tick the box if it is the same person.")) return;
    if (step === 3 && !need("efin", "An EFIN is six digits.")) return;
    go(Math.min(step + 1, last));
  };
  const submit = () =>
    start(async () => {
      const data = new FormData(form.current!);
      const result: FormResult = await onboardEroAction(data);
      if (!result) return;
      setError(result.error);
      if (result.field) { setStep(stepOf(result.field)); setTimeout(() => mark(result.field!), 50); }
    });

  const v = review;
  const pretty = (a: { line1?: string; city?: string; state?: string; zip?: string }) => displayAddress({ line1: formatStreet(a.line1 ?? ""), city: formatCity(a.city ?? ""), state: a.state, zip: a.zip });
  const picked = options.filter((o) => chosen.includes(o.id));
  const rows: { title: string; step: number; items: [string, React.ReactNode][] }[] = [
    { title: "Firm", step: 0, items: [
      ["Relationship", RELATIONSHIPS.find((r) => r.value === (v.relationship ?? relationship))?.title],
      ["Legal name", v.legal_name], ["Doing business as", v.dba_name], ["Business type", structureLabel(v.business_structure)],
      ["EIN", v.ein ? `••-•••${v.ein.replace(/\D/g, "").slice(-4)}` : ""],
    ] },
    { title: "Locations", step: 1, items: [
      ["Main location", [v.office_name || "Main office", pretty({ line1: v.line1, city: v.city, state: v.state, zip: v.zip })].filter(Boolean).join(" · ")],
      ...[0, 1, 2, 3, 4].filter((i) => v[`extra_name_${i}`]).map((i): [string, React.ReactNode] => [`Location ${i + 2}`, [v[`extra_name_${i}`], pretty({ line1: v[`extra_line1_${i}`], city: v[`extra_city_${i}`], state: v[`extra_state_${i}`], zip: v[`extra_zip_${i}`] })].filter(Boolean).join(" · ")]),
    ] },
    { title: "ERO", step: 2, items: [
      ["Name", v.person_name], ["Email", v.person_email?.toLowerCase()], ["Phone", displayPhone(v.person_phone)],
      ...(team ? ([["PTIN", v.ptin ? `P••••${v.ptin.slice(-4)}` : ""], ["PTIN status", v.ptin ? confirmLabel(v.ptin_verification) : ""], ["PTIN source", v.ptin ? v.ptin_source : ""], ["PTIN renewal date", v.ptin ? v.ptin_expires_on : ""]] as [string, React.ReactNode][]) : []),
    ] },
    { title: "Responsible party", step: 2, items: sameResponsible ? [["Who", "Same person as the ERO"]] : [["Name", v.resp_name], ["Email", v.resp_email?.toLowerCase()], ["Phone", displayPhone(v.resp_phone)]] },
    { title: "EFIN", step: 3, items: [
      ["EFIN", v.efin ? `••${v.efin.slice(-4)}` : ""], ["Status", confirmLabel(v.efin_verification)], ["How it was confirmed", v.efin_source],
      ["Next review date", v.recorded_expiration], ["Review date confirmed", v.recorded_expiration ? (v.expiration_verified ? "Yes" : "No") : ""], ["Tax year", v.tax_year],
    ] },
    { title: "Software & banking", step: 4, items: [
      ["Tax software", picked.filter((o) => o.kind === "tax_software").map((o) => o.name).join(", ")],
      ["Bank products", picked.filter((o) => o.kind === "bank_product").map((o) => o.name).join(", ")],
    ] },
  ];

  return (
    <div className="efin-wiz">
      <ol className="efin-steps-nav" aria-label="Onboarding steps">
        {STEPS.map((name, i) => (
          <li key={name} className={i === step ? "is-now" : i < step ? "is-done" : ""}>
            <button type="button" disabled={i > step} onClick={() => go(i)}><span>{i < step ? "✓" : i + 1}</span>{name}</button>
          </li>
        ))}
      </ol>

      <form
        ref={form}
        className="efin-wiz-body"
        onSubmit={(e) => { e.preventDefault(); if (step === last) submit(); else next(); }}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT" && step < last) { e.preventDefault(); next(); } }}
        aria-busy={pending}
      >
        {error && <div className="monarch-alert is-error" role="alert">{error} <small>Nothing was saved. Everything you entered is still here.</small></div>}

        <section hidden={step !== 0} className="efin-wiz-step">
          <h2>Tell us about the firm</h2>
          <p className="monarch-muted">Start with how this firm relates to you. That decides what the rest of the setup asks for.</p>
          <div className="efin-rel">
            {RELATIONSHIPS.map((r) => (
              <label key={r.value} className={relationship === r.value ? "is-on" : ""}>
                <input type="radio" name="relationship" value={r.value} checked={relationship === r.value} onChange={() => setRelationship(r.value)} />
                <b>{r.title}</b><small>{r.note}</small>
              </label>
            ))}
          </div>
          <div className="monarch-form">
            <label>Legal name<input name="legal_name" maxLength={200} autoComplete="off" /></label>
            <label>Doing business as (optional)<input name="dba_name" maxLength={200} /></label>
            <label>Business type<select name="business_structure" defaultValue=""><option value="">Not set</option>{STRUCTURE_OPTIONS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</select></label>
            <label>EIN (optional)<FormattedInput kind="ein" name="ein" /></label>
          </div>
          <input type="hidden" name="agreement_status" value="pending" />
        </section>

        <section hidden={step !== 1} className="efin-wiz-step">
          <h2>Where do they operate?</h2>
          <p className="monarch-muted">The main location now. You can add more here or later from the firm page.</p>
          <div className="monarch-form">
            <label>Location name<input name="office_name" maxLength={200} defaultValue="Main office" /></label>
            <label>Street address<input name="line1" maxLength={200} /></label>
            <label>City<input name="city" maxLength={100} /></label>
            <label>State<FormattedInput kind="state" name="state" /></label>
            <label>ZIP<FormattedInput kind="zip" name="zip" /></label>
          </div>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} hidden={i >= extra} className="efin-extra">
              <h3>Location {i + 2}</h3>
              <div className="monarch-form">
                <label>Location name<input name={`extra_name_${i}`} maxLength={200} /></label>
                <label>Street address<input name={`extra_line1_${i}`} maxLength={200} /></label>
                <label>City<input name={`extra_city_${i}`} maxLength={100} /></label>
                <label>State<FormattedInput kind="state" name={`extra_state_${i}`} /></label>
                <label>ZIP<FormattedInput kind="zip" name={`extra_zip_${i}`} /></label>
              </div>
            </div>
          ))}
          {extra < 5 && <button type="button" className="monarch-secondary efin-small" onClick={() => setExtra((n) => n + 1)}>+ Add another location</button>}
        </section>

        <section hidden={step !== 2} className="efin-wiz-step">
          <h2>Who is the ERO?</h2>
          <p className="monarch-muted">The person we deal with for this firm.</p>
          <div className="monarch-form">
            <label>Full name<input name="person_name" maxLength={200} autoComplete="off" /></label>
            <label>Email<input name="person_email" type="email" maxLength={254} /></label>
            <label>Phone<FormattedInput kind="phone" name="person_phone" /></label>
            <input type="hidden" name="role_verification" value="unverified" />
          </div>
          <label className="efin-same">
            <input type="checkbox" checked={sameResponsible} onChange={(e) => setSameResponsible(e.target.checked)} />
            <span><b>This person is also the EFIN&apos;s responsible party</b><small>The Responsible Official named on the EFIN application. Untick it if someone else is responsible.</small></span>
          </label>
          <input type="hidden" name="responsible_same" value={sameResponsible ? "yes" : "no"} />
          {!sameResponsible && (
            <div className="efin-extra">
              <h3>Responsible party</h3>
              <div className="monarch-form">
                <label>Full name<input name="resp_name" maxLength={200} autoComplete="off" /></label>
                <label>Email<input name="resp_email" type="email" maxLength={254} /></label>
                <label>Phone<FormattedInput kind="phone" name="resp_phone" /></label>
              </div>
            </div>
          )}
          {team ? (
            <div className="efin-extra">
              <h3>PTIN (optional)</h3>
              <p className="monarch-muted">Recorded as a separate protected credential. It never authorizes e-file by itself. PTINs renew each year, so add the renewal date if you have it. You can add other preparers later.</p>
              <div className="monarch-form">
                <label>PTIN<FormattedInput kind="ptin" name="ptin" /></label>
                <label>Status<select name="ptin_verification" defaultValue="unverified">{CONFIRM.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
                <label>How it was confirmed<input name="ptin_source" maxLength={300} /></label>
                <label>PTIN renewal date<input name="ptin_expires_on" type="date" /></label>
              </div>
            </div>
          ) : (
            <p className="efin-note-soft">Software and service clients keep no PTINs or team, so there is nothing more to enter here.</p>
          )}
        </section>

        <section hidden={step !== 3} className="efin-wiz-step">
          <h2>Their EFIN</h2>
          <p className="monarch-muted">Encrypted when saved; only the last four digits stay readable. Recording it here does not apply for, renew or confirm it with the IRS.</p>
          <div className="monarch-form">
            <label>EFIN (six digits)<FormattedInput kind="efin" name="efin" /></label>
            <label>Status<select name="efin_verification" defaultValue="unverified">{CONFIRM.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
            <label className="is-wide">How it was confirmed<input name="efin_source" maxLength={300} placeholder="e.g. IRS acceptance letter dated…" /></label>
            <label>Next review date (optional)<input name="recorded_expiration" type="date" /></label>
            <label>Tax year<input name="tax_year" type="number" min={2000} max={2100} /></label>
            <p className="efin-note-soft is-wide" style={{ margin: 0 }}>An EFIN does not carry a fixed expiration date the way a PTIN does. Use the review date for when you want to re-check this firm&apos;s e-file application, or a date the IRS gave you. Software renewal dates are recorded separately, with the software.</p>
            <label className="monarch-check is-wide"><input type="checkbox" name="expiration_verified" /> I confirmed that date from a source. Reminders only run from confirmed dates.</label>
          </div>
        </section>

        <section hidden={step !== 4} className="efin-wiz-step">
          <h2>Software &amp; banking</h2>
          <p className="monarch-muted">What this firm uses, from the lists in Settings.</p>
          {options.length === 0 ? (
            <p className="efin-note-soft">Your lists are empty. <Link href="/bureau/settings" target="_blank" className="efin-card-link">Add your tax software and bank products in Settings</Link>, then reload this page. You can also choose them later from the firm.</p>
          ) : (
            (["tax_software", "bank_product"] as const).map((kind) => {
              const list = options.filter((o) => o.kind === kind);
              return list.length === 0 ? null : (
                <div className="efin-extra" key={kind}>
                  <h3>{kind === "tax_software" ? "Tax software" : "Bank products"}</h3>
                  <div className="efin-checks">
                    {list.map((o) => (
                      <label key={o.id} className="monarch-check"><input type="checkbox" name="option_ids" value={o.id} checked={chosen.includes(o.id)} onChange={(e) => setChosen((c) => (e.target.checked ? [...c, o.id] : c.filter((x) => x !== o.id)))} /> {o.name}</label>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </section>

        <section hidden={step !== last} className="efin-wiz-step">
          <h2>Review and save</h2>
          <p className="monarch-muted">Everything you entered is below. Use Edit to fix anything. It is saved together, or not at all.</p>
          {rows.map((r) => {
            const shown = r.items.filter(([, val]) => val !== undefined && val !== null && val !== "");
            return (
              <div className="efin-review-block" key={r.title}>
                <div className="efin-review-head"><h3>{r.title}</h3><button type="button" className="efin-card-link efin-linkbtn" onClick={() => go(r.step)}>Edit</button></div>
                {shown.length === 0 ? <p className="monarch-muted" style={{ margin: 0 }}>Nothing entered.</p> : (
                  <dl className="efin-review">{shown.map(([k, val]) => <div key={k}><dt>{k}</dt><dd>{val}</dd></div>)}</dl>
                )}
              </div>
            );
          })}
        </section>

        <div className="efin-wiz-foot">
          <button type="button" className="monarch-secondary" onClick={() => go(Math.max(step - 1, 0))} disabled={step === 0 || pending}>Back</button>
          {step < last ? (
            <button key="continue" type="button" className="monarch-primary" onClick={next}>Continue</button>
          ) : (
            <button key="save" type="submit" className="monarch-primary" disabled={pending}>{pending ? "Saving…" : "Save firm"}</button>
          )}
        </div>
      </form>
    </div>
  );
}
