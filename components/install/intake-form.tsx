"use client";

import { useActionState, useState } from "react";
import { submitIntakeAction, type IntakeState } from "@/app/install/actions";
import { PLATFORM_GUIDES, PLATFORM_ORDER } from "@/lib/commerce/platforms.ts";
import type { Platform } from "@/lib/commerce/types.ts";

export function IntakeForm({ token, options, defaultType }: { token: string; options: string[]; defaultType: string }) {
  const [state, action, pending] = useActionState<IntakeState, FormData>(submitIntakeAction, {});
  const [platform, setPlatform] = useState<Platform | "">("");

  if (state.done) {
    const guide = PLATFORM_GUIDES[state.done.platform];
    return (
      <div className="monarch-form-done">
        <h2>Thank you — your details were received.</h2>
        {!state.done.selfService ? (
          <p>Our team will install the calculator on <b>{state.done.domain}</b> for you and confirm once it is live. You do not need to do anything else.</p>
        ) : state.done.snippet ? (
          <>
            <p>Your calculator is authorized for <b>{state.done.domain}</b>. Install it on {guide.label}:</p>
            <ol>{guide.steps.map((s) => <li key={s}>{s}</li>)}</ol>
            <label>Embed code<textarea readOnly rows={4} value={state.done.snippet} /></label>
            <label>Calculator URL (for platforms that only accept a URL)<input readOnly value={state.done.url ?? ""} /></label>
            {guide.limitations.length > 0 && <ul className="monarch-muted">{guide.limitations.map((l) => <li key={l}>{l}</li>)}</ul>}
          </>
        ) : (
          <p>We have your details. Your installation code will be sent once your license is activated for <b>{state.done.domain}</b>.</p>
        )}
      </div>
    );
  }

  return (
    <form action={action} className="monarch-form">
      <input type="hidden" name="token" value={token} />
      <label className="is-wide">Which platform hosts your website, funnel, or form?
        <select name="platform" required value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}>
          <option value="" disabled>Choose a platform</option>
          {PLATFORM_ORDER.map((p) => <option key={p} value={p}>{PLATFORM_GUIDES[p].label}</option>)}
        </select>
      </label>
      {platform === "other" && <label className="is-wide">Platform name<input name="platform_other" required maxLength={80} placeholder="e.g. Squarespace, WordPress, Kajabi" /></label>}
      <label className="is-wide">Page or funnel URL where the calculator should appear<input name="website_url" required maxLength={500} placeholder="https://yourbusiness.com/tax-calculator" /></label>
      <label className="is-wide">Domain where the calculator will run<input name="domain" required maxLength={253} placeholder="yourbusiness.com" /></label>
      {options.length > 1 ? (
        <fieldset className="is-wide">
          <legend>Installation</legend>
          <label className="monarch-check"><input type="radio" name="installation_type" value="self_service" defaultChecked={defaultType === "self_service"} required /> I will install it myself (Self-Service)</label>
          <label className="monarch-check"><input type="radio" name="installation_type" value="done_for_you" defaultChecked={defaultType === "done_for_you"} /> Install it for me (Done For You)</label>
        </fieldset>
      ) : (
        <input type="hidden" name="installation_type" value={options[0] ?? defaultType} />
      )}
      {platform && <p className="monarch-muted is-wide">{PLATFORM_GUIDES[platform].supportNote}</p>}
      {state.error && <p className="monarch-alert is-error is-wide">{state.error}</p>}
      <div className="is-wide"><button className="monarch-primary" disabled={pending} type="submit">{pending ? "Sending…" : "Submit installation details"}</button></div>
    </form>
  );
}
