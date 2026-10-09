"use client";

import { useActionState, useState } from "react";
import { checkUpdateAction, startUpdateCheckoutAction, type UpdateState } from "@/app/update/actions";

const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

export function UpdateForm() {
  const [state, action, pending] = useActionState<UpdateState, FormData>(checkUpdateAction, {});
  const [key, setKey] = useState("");
  const info = state.info;
  return (
    <>
      <form action={action} className="monarch-form">
        <label className="is-wide">License key
          <input name="license_key" required value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" placeholder="MTS-XXXXX-XXXXX-XXXXX-XXXXX" />
        </label>
        <div className="is-wide"><button className="monarch-secondary" disabled={pending} type="submit">{pending ? "Checking…" : "Check my license"}</button></div>
      </form>
      {state.error && <p className="monarch-alert is-error">{state.error}</p>}
      {info && (
        <div className="monarch-form-done">
          <p>Your license covers the <b>{info.currentYear ?? "original"}</b> tax-year calculator{info.latestYear ? <>; the newest version is <b>{info.latestYear}</b></> : null}.</p>
          {info.eligible ? (
            <>
              <h2>{info.label} — {money(info.priceCents!)} one-time</h2>
              <ul>
                <li>Upgrades your existing license to the {info.latestYear} tax-year calculator, including all bug fixes and corrections released for {info.latestYear}.</li>
                <li>One-time payment. No subscription and no automatic renewal.</li>
                <li>Optional: if you skip it, you keep your current {info.currentYear} version.</li>
              </ul>
              <form action={startUpdateCheckoutAction}>
                <input type="hidden" name="license_key" value={key} />
                <button className="monarch-primary" type="submit">Buy the {info.latestYear} update</button>
              </form>
            </>
          ) : info.reason === "license_inactive" ? (
            <p>This license is not active, so updates cannot be purchased. Please contact Monarch Tax Suite.</p>
          ) : (
            <p>You already have the newest version. Bug fixes for your version are included at no charge.</p>
          )}
        </div>
      )}
    </>
  );
}
