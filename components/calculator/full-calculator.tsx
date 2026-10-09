"use client";

import { useEffect, useRef, useState } from "react";
import { computeFull, FULL_STATUS_LABELS, FULL_STATUSES, fullHeadline, fullMoney, NEEDS_INCOME_MESSAGE, num, type FullInputs, type FullResult, type FullStatus, type YesNo } from "@/lib/calculator/full";
import type { LeadCaptureConfig } from "./lead-form";

// The full 2026 refund calculator (same layout, fields and math as the
// published demo). When the license holder turned on lead capture, contact
// fields and a consent box appear and the button also sends the visitor's
// details and the calculated results to the holder's own CRM through the
// licensed lead endpoint. Without lead capture it is a plain calculator.

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(16).padStart(8, "0")}-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, "0")}`);

type Sent = "idle" | "sending" | "sent";

function Num({ id, label, value, set, help, error }: { id: string; label: string; value: string; set: (v: string) => void; help?: string; error?: boolean }) {
  return (
    <div>
      <label className="fc-label" htmlFor={id}>{label}</label>
      <input className={"fc-input" + (error ? " fc-error" : "")} id={id} type="number" inputMode="decimal" min="0" step="1" placeholder="0" value={value} onChange={(e) => set(e.target.value)} />
      {help && <div className="fc-help">{help}</div>}
    </div>
  );
}

function YesNoSelect({ id, label, value, set, blank }: { id: string; label: string; value: string; set: (v: string) => void; blank?: boolean }) {
  return (
    <div>
      <label className="fc-label" htmlFor={id}>{label}</label>
      <select className="fc-select" id={id} value={value} onChange={(e) => set(e.target.value)}>
        {blank && <option value="">Select</option>}
        <option value="Yes">Yes</option>
        <option value="No">No</option>
      </select>
    </div>
  );
}

export function FullCalculator({ leadCapture }: { leadCapture?: LeadCaptureConfig }) {
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [honeypot, setHoneypot] = useState("");
  const [status, setStatus] = useState<FullStatus>("single");
  const [wages, setWages] = useState("");
  const [withholding, setWithholding] = useState("");
  const [netProfit, setNetProfit] = useState("");
  const [investment, setInvestment] = useState("");
  const [kids, setKids] = useState("");
  const [eicAge, setEicAge] = useState<YesNo>("");
  const [eicUs, setEicUs] = useState<YesNo>("");
  const [eicDependent, setEicDependent] = useState(false);
  const [eicMfsApart, setEicMfsApart] = useState(false);
  const [tips, setTips] = useState("");
  const [overtime, setOvertime] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [seniorSelf, setSeniorSelf] = useState(false);
  const [seniorSpouse, setSeniorSpouse] = useState(false);
  const [tipsQ, setTipsQ] = useState("Yes");
  const [overtimeQ, setOvertimeQ] = useState("Yes");
  const [vehicleQ, setVehicleQ] = useState("Yes");
  const [other, setOther] = useState("");

  const [result, setResult] = useState<FullResult | null>(null);
  const [warn, setWarn] = useState("");
  const [bad, setBad] = useState<string[]>([]);
  const [sent, setSent] = useState<Sent>("idle");
  const submissionId = useRef(newId());
  const resultsRef = useRef<HTMLDivElement>(null);

  // In an iframe, report content height so host pages that listen can resize the frame.
  useEffect(() => {
    if (typeof window === "undefined" || window.parent === window) return;
    const send = () => window.parent.postMessage({ type: "monarch-calculator:height", height: document.documentElement.scrollHeight }, "*");
    send();
    const ro = new ResizeObserver(send);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, []);

  const kidCount = Math.floor(num(kids));
  const joint = status === "mfj";

  function gather(): FullInputs {
    return {
      status, wages: num(wages), withholding: num(withholding), netProfit: num(netProfit), investment: num(investment), kids: kidCount,
      tips: num(tips), overtime: num(overtime), vehicleInterest: num(vehicle), otherAdjustments: num(other),
      seniorSelf, seniorSpouse: seniorSpouse && joint, tipsQualified: tipsQ === "Yes", overtimeQualified: overtimeQ === "Yes", vehicleQualified: vehicleQ === "Yes",
      eicAge, eicUs, eicDependent, eicMfsApart,
    };
  }

  async function submit() {
    setWarn("");
    setBad([]);
    if (leadCapture) {
      if (!first.trim()) return (setBad(["fc_first"]), setWarn("Enter your first name."));
      if (!email.trim() && !phone.trim()) return (setBad(["fc_email", "fc_phone"]), setWarn("Enter an email address or phone number."));
      if (email.trim() && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email.trim())) return (setBad(["fc_email"]), setWarn("Enter a valid email address."));
      if (!consent) return setWarn("Please agree to be contacted so your results can be sent.");
    }
    const inputs = gather();
    const r = computeFull(inputs);
    if (!r) {
      setBad(["fc_wages", "fc_senet"]);
      setWarn(NEEDS_INCOME_MESSAGE);
      return;
    }
    setResult(r);
    resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (!leadCapture || sent === "sent") return;

    setSent("sending");
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: leadCapture.token,
          submissionId: submissionId.current,
          firstName: first,
          lastName: last,
          email: email.trim(),
          phone: phone.trim(),
          consent: true,
          website: honeypot,
          inputs: leadCapture.includeSummary ? inputs : undefined,
        }),
      });
      if (res.ok) return setSent("sent");
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setWarn(`${data.error ?? "Something went wrong."} Your estimate is shown below; press the button again to retry sending.`);
    } catch {
      setWarn("Could not send your details. Check your connection and press the button again. Your estimate is shown below.");
    }
    setSent("idle");
  }

  const err = (id: string) => bad.includes(id);
  const lines: [string, number][] = result
    ? [
        ["Federal income tax after child tax credit", result.incomeTaxAfterCredits],
        ["Self-employment tax", result.seTax],
        ["Additional Medicare tax", result.additionalMedicare],
        ["Earned Income Tax Credit (EITC)", result.eitc],
        ["Refundable Additional Child Tax Credit", result.actc],
        ["Schedule 1-A deductions entered", result.schedule1A],
        ["Standard deduction used", result.standardDeduction],
        ["Adjusted gross income (estimate)", result.agi],
        ["Taxable income (estimate)", result.taxableIncome],
      ]
    : [["Federal income tax", 0], ["Self-employment tax", 0], ["EITC", 0], ["ACTC", 0], ["Schedule 1-A deductions", 0]];
  const title = leadCapture?.businessName ? `${leadCapture.businessName} Refund Calculator` : "Refund Calculator";
  const buttonLabel = sent === "sending" ? "Sending…" : leadCapture ? (sent === "sent" ? "Calculate Again" : "Calculate and Send My Results") : "Calculate My Estimated Refund";

  return (
    <div className="fullcalc">
      <div className="fc-wrap">
        <div className="fc-grid">
          <form className="fc-card" onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
            <h3>{title}</h3>
            <div className="fc-version">2026 Tax Year • 2027 Filing Season</div>

            {leadCapture && (
              <div className="fc-section" style={{ marginTop: 14, paddingTop: 0, borderTop: 0 }}>
                <div className="fc-section-title">Contact Information</div>
                <div className="fc-row">
                  <div><label className="fc-label" htmlFor="fc_first">First Name</label><input className={"fc-input" + (err("fc_first") ? " fc-error" : "")} id="fc_first" type="text" placeholder="First name" autoComplete="given-name" maxLength={60} value={first} onChange={(e) => setFirst(e.target.value)} /></div>
                  <div><label className="fc-label" htmlFor="fc_last">Last Name</label><input className="fc-input" id="fc_last" type="text" placeholder="Last name" autoComplete="family-name" maxLength={60} value={last} onChange={(e) => setLast(e.target.value)} /></div>
                </div>
                <div className="fc-row">
                  <div><label className="fc-label" htmlFor="fc_email">Email</label><input className={"fc-input" + (err("fc_email") ? " fc-error" : "")} id="fc_email" type="email" placeholder="name@email.com" autoComplete="email" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} /></div>
                  <div><label className="fc-label" htmlFor="fc_phone">Mobile Phone</label><input className={"fc-input" + (err("fc_phone") ? " fc-error" : "")} id="fc_phone" type="tel" inputMode="tel" placeholder="Phone number" autoComplete="tel" maxLength={40} value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
                </div>
                <div className="fc-help">Email or phone is required.</div>
                <input className="fc-hp" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
              </div>
            )}

            <div className="fc-section" style={leadCapture ? undefined : { marginTop: 14, paddingTop: 0, borderTop: 0 }}>
              <div className="fc-section-title">Income &amp; Filing Information</div>
              <div className="fc-row">
                <div>
                  <label className="fc-label" htmlFor="fc_status">Filing Status</label>
                  <select className="fc-select" id="fc_status" value={status} onChange={(e) => { const s = e.target.value as FullStatus; setStatus(s); if (s !== "mfj") setSeniorSpouse(false); }}>
                    {FULL_STATUSES.map((s) => <option key={s} value={s}>{FULL_STATUS_LABELS[s]}</option>)}
                  </select>
                </div>
                <Num id="fc_wages" label="W-2 Wages ($)" value={wages} set={setWages} error={err("fc_wages")} />
              </div>
              <div className="fc-row">
                <Num id="fc_wh" label="Federal Income Tax Withheld ($)" value={withholding} set={setWithholding} />
                <Num id="fc_senet" label="Self-Employment Net Profit ($)" value={netProfit} set={setNetProfit} error={err("fc_senet")} />
              </div>
              <div className="fc-row">
                <Num id="fc_inv" label="Investment Income ($)" value={investment} set={setInvestment} />
                <Num id="fc_kids" label="Qualifying Children Under 17" value={kids} set={setKids} />
              </div>

              {kidCount === 0 && (
                <div className="fc-section" style={{ marginTop: 14 }}>
                  <div className="fc-section-title">EITC — No Qualifying Child</div>
                  <div className="fc-row">
                    <div>
                      <label className="fc-label" htmlFor="fc_eic_age">Age 25–64 at year end?</label>
                      <select className="fc-select" id="fc_eic_age" value={eicAge} onChange={(e) => setEicAge(e.target.value as YesNo)}><option value="">Select</option><option value="Yes">Yes</option><option value="No">No</option></select>
                    </div>
                    <div>
                      <label className="fc-label" htmlFor="fc_eic_us">Lived in the U.S. more than half the year?</label>
                      <select className="fc-select" id="fc_eic_us" value={eicUs} onChange={(e) => setEicUs(e.target.value as YesNo)}><option value="">Select</option><option value="Yes">Yes</option><option value="No">No</option></select>
                    </div>
                  </div>
                  <label className="fc-check"><input id="fc_eic_dep" type="checkbox" checked={eicDependent} onChange={(e) => setEicDependent(e.target.checked)} /> I can be claimed as a dependent by another taxpayer.</label>
                  {status === "mfs" && <label className="fc-check"><input id="fc_eic_mfs_apart" type="checkbox" checked={eicMfsApart} onChange={(e) => setEicMfsApart(e.target.checked)} /> If filing MFS, I lived apart from my spouse for the last 6 months of 2026.</label>}
                </div>
              )}
            </div>

            <div className="fc-section">
              <div className="fc-section-title">2026 Additional Deductions</div>
              <div className="fc-help">These deductions may be available when the taxpayer meets the applicable IRS requirements.</div>
              <div className="fc-row">
                <Num id="fc_tips" label="Qualified Tips ($)" value={tips} set={setTips} help="Up to $25,000 may qualify, subject to eligibility and income limits." />
                <Num id="fc_overtime" label="Qualified Overtime Compensation ($)" value={overtime} set={setOvertime} help="Up to $12,500, or $25,000 for MFJ, may qualify." />
              </div>
              <div className="fc-row">
                <Num id="fc_vehicle" label="Qualified Vehicle Loan Interest ($)" value={vehicle} set={setVehicle} help="Up to $10,000 may qualify for an eligible vehicle." />
                <div>
                  <span className="fc-label">Senior Deduction</span>
                  <label className="fc-check"><input id="fc_senior_self" type="checkbox" checked={seniorSelf} onChange={(e) => setSeniorSelf(e.target.checked)} /> Taxpayer was born before Jan. 2, 1962.</label>
                  <label className="fc-check" style={{ opacity: joint ? 1 : 0.55 }}><input id="fc_senior_spouse" type="checkbox" disabled={!joint} checked={joint && seniorSpouse} onChange={(e) => setSeniorSpouse(e.target.checked)} /> Spouse was born before Jan. 2, 1962 (MFJ only).</label>
                </div>
              </div>
              <div className="fc-row">
                <YesNoSelect id="fc_tips_q" label="Tips qualify?" value={tipsQ} set={setTipsQ} />
                <YesNoSelect id="fc_overtime_q" label="Overtime qualifies?" value={overtimeQ} set={setOvertimeQ} />
              </div>
              <div className="fc-row">
                <YesNoSelect id="fc_vehicle_q" label="Vehicle loan qualifies?" value={vehicleQ} set={setVehicleQ} />
                <Num id="fc_other" label="Other Adjustments / Deductions ($)" value={other} set={setOther} />
              </div>
            </div>

            {leadCapture && (
              <label className="fc-check fc-consent">
                <input id="fc_consent" type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                <span>
                  I agree that {leadCapture.businessName} may contact me about my estimate by email, phone or text.
                  {leadCapture.includeSummary ? " My contact details and my estimated results (refund or balance due, tax, credits and deductions) will be sent to them; the income figures I entered will not." : " Only my contact details will be sent to them."}
                </span>
              </label>
            )}

            <div className="fc-actions">
              <button className="fc-btn" id="fc_calc" type="submit" disabled={sent === "sending"}>{buttonLabel}</button>
            </div>
            <div className="fc-warn" id="fc_warn" aria-live="polite" style={{ display: warn ? "block" : "none" }} role={warn ? "alert" : undefined}>{warn}</div>
            {leadCapture && sent === "sent" && <div className="fc-sent" id="fc_sent" role="status">Thank you. Your details and results were sent to {leadCapture.businessName}; they will be in touch.</div>}
          </form>

          <div className="fc-card" id="fc_results" ref={resultsRef}>
            <div className="fc-result-label">2026 Tax Year • 2027 Filing Season</div>
            <div className="fc-big" id="fc_refund_big">{result ? fullHeadline(result.difference) : "Enter your information"}</div>
            <div className="fc-pills">
              <div className="fc-pill"><div className="fc-pill-label">Estimated Federal Tax</div><div className="fc-pill-val" id="fc_tax_pill">{fullMoney(result?.totalTax ?? 0)}</div></div>
              <div className="fc-pill"><div className="fc-pill-label">Withholding + Refundable Credits</div><div className="fc-pill-val" id="fc_payments_pill">{fullMoney(result?.payments ?? 0)}</div></div>
            </div>
            <div className="fc-breakdown" id="fc_breakdown">
              {lines.map(([label, value]) => <div className="fc-line" key={label}><span>{label}</span><strong>{fullMoney(value)}</strong></div>)}
            </div>
            <div className="fc-note">This is a preliminary federal tax estimate, not a completed tax return. Final results depend on all income, deductions, credits, filing information, and IRS eligibility requirements. Do not enter Social Security numbers or other sensitive personal information.</div>
          </div>
        </div>
      </div>
      <style jsx global>{`
        .fullcalc{font-family:Inter,Arial,Helvetica,sans-serif;color:#111;background:#fff}.fullcalc *{box-sizing:border-box}
        .fullcalc .fc-wrap{max-width:1040px;margin:0 auto;padding:16px}.fullcalc .fc-grid{display:grid;grid-template-columns:1.25fr .75fr;gap:16px;align-items:start}
        .fullcalc .fc-card{border:1px solid #ddd;border-radius:14px;padding:18px;background:#fff;min-width:0}
        .fullcalc h3{margin:0 0 14px;font-size:14px;font-weight:800;text-transform:uppercase;letter-spacing:.2px}
        .fullcalc .fc-row{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}
        .fullcalc .fc-label{display:block;font-size:12px;font-weight:700;margin-bottom:6px}
        .fullcalc .fc-input,.fullcalc .fc-select{width:100%;min-height:44px;padding:11px 12px;border:1px solid #cfcfcf;border-radius:9px;background:#fff;color:#111;font-size:16px}
        .fullcalc .fc-input:focus,.fullcalc .fc-select:focus{border-color:#000;outline:2px solid #000}
        .fullcalc .fc-help{margin-top:5px;font-size:11px;line-height:1.4;color:#666}
        .fullcalc .fc-actions{margin-top:16px}
        .fullcalc .fc-btn{width:100%;min-height:46px;border:1px solid #000;border-radius:9px;background:#000;color:#fff;font-weight:800;font-size:14px;cursor:pointer;padding:11px 14px}.fullcalc .fc-btn:disabled{opacity:.6;cursor:wait}
        .fullcalc .fc-warn{margin-top:12px;padding:10px 12px;border:1px solid #e3bcbc;background:#fff5f5;color:#a00000;border-radius:9px;font-size:12px;line-height:1.4}
        .fullcalc .fc-sent{margin-top:12px;padding:10px 12px;border:1px solid #000;border-radius:9px;font-size:12px;font-weight:700;line-height:1.4}
        .fullcalc .fc-result-label{font-size:12px;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:.2px}
        .fullcalc .fc-big{font-size:30px;font-weight:900;margin-top:8px;line-height:1.2;overflow-wrap:anywhere}
        .fullcalc .fc-pills{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:16px}
        .fullcalc .fc-pill{border:1px solid #ddd;border-radius:10px;padding:12px;min-width:0}.fullcalc .fc-pill-label{font-size:11px;color:#666;margin-bottom:5px}.fullcalc .fc-pill-val{font-size:16px;font-weight:900;overflow-wrap:anywhere}
        .fullcalc .fc-breakdown{margin-top:16px;border-top:1px solid #ddd;padding-top:12px;display:grid;gap:9px}
        .fullcalc .fc-line{display:flex;justify-content:space-between;gap:12px;font-size:12px;border-bottom:1px solid #eee;padding-bottom:8px}.fullcalc .fc-line strong{text-align:right}
        .fullcalc .fc-note{margin-top:14px;padding:11px 12px;border:1px solid #ddd;border-radius:9px;font-size:11px;line-height:1.5;color:#444}
        .fullcalc .fc-section{margin-top:18px;padding-top:16px;border-top:1px solid #ddd}.fullcalc .fc-section-title{font-size:13px;font-weight:800;margin-bottom:4px}
        .fullcalc .fc-check{display:flex;gap:8px;align-items:flex-start;font-size:12px;font-weight:600;line-height:1.4;margin-top:8px}.fullcalc .fc-check input{margin-top:3px;width:auto;min-height:auto}
        .fullcalc .fc-consent{margin-top:18px;padding-top:16px;border-top:1px solid #ddd;font-weight:400}
        .fullcalc .fc-version{font-size:11px;color:#666;margin-top:5px}.fullcalc .fc-error{border-color:#a00000 !important}
        .fullcalc .fc-hp{position:absolute;left:-9999px;width:1px;height:1px;opacity:0}
        @media(max-width:900px){.fullcalc .fc-grid{grid-template-columns:1fr}}
        @media(max-width:560px){.fullcalc .fc-row,.fullcalc .fc-pills{grid-template-columns:1fr}}
      `}</style>
    </div>
  );
}
