"use client";

import { useRef, useState, useTransition } from "react";
import { onboardEroAction, type FormResult } from "./actions";
import { FormattedInput } from "./formatted-input";
import { displayAddress, displayPhone, formatCity, formatStreet } from "@/lib/efin/format.ts";
import { STRUCTURE_OPTIONS, structureLabel } from "@/lib/efin/text.ts";

const STEPS = ["Firm", "Locations", "Contact", "EFIN", "Review"] as const;
const VERIFY = [
  { value: "unverified", label: "Not yet verified" },
  { value: "manually_verified", label: "Manually verified (I checked it myself)" },
  { value: "verified", label: "Verified (from a source I can name)" },
];
const RELATIONSHIPS = [
  { value: "client", title: "Software / service client", note: "They bought software or services from me. I keep their firm, locations, contact and EFIN only: no team or PTINs." },
  { value: "partner", title: "Partner", note: "I may manage some of their preparers." },
  { value: "internal", title: "My own tax office", note: "I manage its preparers and PTINs." },
  { value: "other", title: "Other", note: "Anything else." },
];
// Which step each server-reported field lives on, so an error jumps back to the right place.
const stepOf = (field: string) => (/^(relationship|legal_name|dba_name|business_structure|ein)$/.test(field) ? 0 : /^(office_name|line1|city|state|zip|extra_)/.test(field) ? 1 : /^(person_|ptin)/.test(field) ? 2 : 3);
const label = (v: string) => v.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

type Values = Record<string, string>;

export function OnboardingWizard() {
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [relationship, setRelationship] = useState("client");
  const [extra, setExtra] = useState(0);
  const [review, setReview] = useState<Values>({});
  const [pending, start] = useTransition();
  const form = useRef<HTMLFormElement>(null);
  const team = relationship !== "client";

  const read = (): Values => Object.fromEntries([...new FormData(form.current!).entries()].map(([k, v]) => [k, String(v)]));
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
  const next = () => {
    setError(null);
    if (step === 0 && !need("legal_name", "Enter the firm's legal name.")) return;
    if (step === 2 && !need("person_name", "Enter the ERO's name.")) return;
    if (step === 3 && !need("efin", "An EFIN is six digits.")) return;
    if (step === 3) setReview(read());
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };
  const back = () => { setError(null); setStep((s) => Math.max(s - 1, 0)); };

  const submit = () =>
    start(async () => {
      const result: FormResult = await onboardEroAction(new FormData(form.current!));
      if (!result) return;
      setError(result.error);
      if (result.field) { setStep(stepOf(result.field)); setTimeout(() => mark(result.field!), 50); }
    });

  const v = review;
  const pretty = (a: { line1?: string; city?: string; state?: string; zip?: string }) => displayAddress({ line1: formatStreet(a.line1 ?? ""), city: formatCity(a.city ?? ""), state: a.state, zip: a.zip });
  const addrLine = pretty({ line1: v.line1, city: v.city, state: v.state, zip: v.zip });
  return (
    <div className="efin-wiz">
      <ol className="efin-steps-nav" aria-label="Onboarding steps">
        {STEPS.map((name, i) => (
          <li key={name} className={i === step ? "is-now" : i < step ? "is-done" : ""}>
            <button type="button" disabled={i > step} onClick={() => { setError(null); setStep(i); if (i === 4) setReview(read()); }}><span>{i < step ? "✓" : i + 1}</span>{name}</button>
          </li>
        ))}
      </ol>

      <form
        ref={form}
        className="efin-wiz-body"
        onSubmit={(e) => { e.preventDefault(); if (step === STEPS.length - 1) submit(); else next(); }}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT" && step < STEPS.length - 1) { e.preventDefault(); next(); } }}
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
          <p className="monarch-muted">The main office now. You can add more locations here or later from the firm page.</p>
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
          {team ? (
            <div className="efin-extra">
              <h3>PTIN (optional)</h3>
              <p className="monarch-muted">Recorded as a separate protected credential. It never authorizes e-file by itself. You can add other preparers later.</p>
              <div className="monarch-form">
                <label>PTIN<FormattedInput kind="ptin" name="ptin" /></label>
                <label>Confirmed?<select name="ptin_verification" defaultValue="unverified">{VERIFY.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
              </div>
            </div>
          ) : (
            <p className="efin-note-soft">Software and service clients keep no PTINs or team, so there is nothing more to enter here.</p>
          )}
        </section>

        <section hidden={step !== 3} className="efin-wiz-step">
          <h2>Their EFIN</h2>
          <p className="monarch-muted">Encrypted when saved; only the last four digits stay readable. Recording it here does not apply for, renew or verify it with the IRS.</p>
          <div className="monarch-form">
            <label>EFIN (six digits)<FormattedInput kind="efin" name="efin" /></label>
            <label>How was it confirmed?<select name="efin_verification" defaultValue="unverified">{VERIFY.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
            <label>Source of that confirmation<input name="efin_source" maxLength={300} placeholder="e.g. IRS acceptance letter dated…" /></label>
            <label>Renewal date on record<input name="recorded_expiration" type="date" /></label>
            <label>Tax year<input name="tax_year" type="number" min={2000} max={2100} /></label>
            <label className="monarch-check"><input type="checkbox" name="expiration_verified" /> I verified that date from a source. Reminders only run from verified dates.</label>
          </div>
        </section>

        <section hidden={step !== 4} className="efin-wiz-step">
          <h2>Review and save</h2>
          <p className="monarch-muted">Check the details. Everything is saved together, or not at all.</p>
          <dl className="efin-review">
            <div><dt>Firm</dt><dd><b>{v.legal_name}</b>{v.dba_name && <> · dba {v.dba_name}</>}<br /><span className="monarch-muted">{RELATIONSHIPS.find((r) => r.value === (v.relationship ?? relationship))?.title}{v.business_structure && ` · ${structureLabel(v.business_structure)}`}{v.ein && ` · EIN ••-•••${v.ein.replace(/\D/g, "").slice(-4)}`}</span></dd></div>
            <div><dt>Locations</dt><dd>{v.office_name || "Main office"}{addrLine && <><br /><span className="monarch-muted">{addrLine}</span></>}{[0, 1, 2, 3, 4].filter((i) => v[`extra_name_${i}`]).map((i) => <div key={i}>{v[`extra_name_${i}`]}<br /><span className="monarch-muted">{pretty({ line1: v[`extra_line1_${i}`], city: v[`extra_city_${i}`], state: v[`extra_state_${i}`], zip: v[`extra_zip_${i}`] })}</span></div>)}</dd></div>
            <div><dt>ERO</dt><dd>{v.person_name}<br /><span className="monarch-muted">{[v.person_email, displayPhone(v.person_phone)].filter(Boolean).join(" · ") || "No email or phone yet"}{team && v.ptin ? ` · PTIN P••••${v.ptin.slice(-4)}` : ""}</span></dd></div>
            <div><dt>EFIN</dt><dd className="efin-mask">••{(v.efin ?? "").slice(-4)}<br /><span className="monarch-muted" style={{ letterSpacing: 0, fontWeight: 400 }}>{label(v.efin_verification ?? "unverified")}{v.recorded_expiration && ` · renews ${v.recorded_expiration}`}</span></dd></div>
          </dl>
        </section>

        <div className="efin-wiz-foot">
          <button type="button" className="monarch-secondary" onClick={back} disabled={step === 0 || pending}>Back</button>
          {step < STEPS.length - 1 ? (
            <button key="continue" type="button" className="monarch-primary" onClick={next}>Continue</button>
          ) : (
            <button key="save" type="submit" className="monarch-primary" disabled={pending}>{pending ? "Saving…" : "Save firm"}</button>
          )}
        </div>
      </form>
    </div>
  );
}
