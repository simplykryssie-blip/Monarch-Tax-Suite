"use client";

import { useState } from "react";

// Optional contact form shown under the estimate on licensed embeds whose
// buyer enabled lead capture. It is a lead form, not a tax return intake.

export type LeadCaptureConfig = { token: string; businessName: string; includeSummary: boolean };
export type LeadSummary = { taxYear: number; filingStatus: string; result: "refund" | "owed"; amount: number };

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(16).padStart(8, "0")}-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, "0")}`);

export function LeadForm({ config, summary }: { config: LeadCaptureConfig; summary: LeadSummary }) {
  const [submissionId] = useState(newId);
  const [status, setStatus] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email") ?? "").trim();
    const phone = String(f.get("phone") ?? "").trim();
    if (!String(f.get("first_name") ?? "").trim()) return setError("Enter your first name.");
    if (!email && !phone) return setError("Enter an email address or phone number.");
    if (f.get("consent") !== "on") return setError("Please agree to be contacted.");
    setStatus("sending");
    setError(null);
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: config.token,
          submissionId,
          firstName: f.get("first_name"),
          lastName: f.get("last_name"),
          email,
          phone,
          consent: f.get("consent") === "on",
          website: f.get("website"),
          summary: config.includeSummary ? summary : null,
        }),
      });
      if (res.ok) return setStatus("done");
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Something went wrong. Please try again.");
    } catch {
      setError("Could not send. Check your connection and try again.");
    }
    setStatus("idle");
  }

  if (status === "done") {
    return (
      <section className="mt-lead" aria-live="polite">
        <h2>Thank you</h2>
        <p>Your details were sent to {config.businessName}. They will be in touch about your estimate.</p>
      </section>
    );
  }

  return (
    <section className="mt-lead">
      <span className="mt-step">NEXT STEP · OPTIONAL</span>
      <h2>Talk to {config.businessName} about your estimate</h2>
      <p className="mt-lead-sub">Share your contact details and {config.businessName} will reach out. This is not a tax return; do not enter Social Security numbers or tax documents.</p>
      <form onSubmit={onSubmit} noValidate>
        <div className="mt-two">
          <label className="mt-field"><span>First name *</span><div className="mt-input-wrap"><input name="first_name" required maxLength={60} autoComplete="given-name" /></div></label>
          <label className="mt-field"><span>Last name</span><div className="mt-input-wrap"><input name="last_name" maxLength={60} autoComplete="family-name" /></div></label>
        </div>
        <div className="mt-two">
          <label className="mt-field"><span>Email</span><div className="mt-input-wrap"><input name="email" type="email" maxLength={254} autoComplete="email" /></div></label>
          <label className="mt-field"><span>Phone</span><div className="mt-input-wrap"><input name="phone" type="tel" maxLength={40} autoComplete="tel" /></div><small>Email or phone is required.</small></label>
        </div>
        <input className="mt-hp" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" />
        <label className="mt-consent">
          <input type="checkbox" name="consent" required />
          <span>
            I agree that {config.businessName} may contact me about my estimate by email, phone or text.
            {config.includeSummary && " My estimate summary (tax year, filing status and estimated refund or amount owed) will be shared with them; my income figures will not."}
          </span>
        </label>
        {error && <p className="mt-lead-error" role="alert">{error}</p>}
        <button className="mt-lead-submit" disabled={status === "sending"}>{status === "sending" ? "Sending…" : "Send my details"}</button>
      </form>
    </section>
  );
}
