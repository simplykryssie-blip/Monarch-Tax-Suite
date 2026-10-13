"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BUILDER_FIELDS, BUILDER_STEPS, calculateScore, CATEGORIES, CATEGORY_ADVICE, CATEGORY_KEYS, DISCLAIMER, EMAIL, ERO_QUESTIONS,
  feeComparison, numberDraft, pageDisclaimer, PURCHASE_ACK, QUESTIONS, scoreVerdict, type EroAnswers, type WispAnswers,
} from "@/lib/wisp/content.ts";
import { recordAuditAction, startWispCheckoutAction } from "@/app/wisp/actions";
import { TermsLinks } from "@/components/storefront/buy-form";

// The WISP Generator page, rebuilt from the owner's static version (wisp-generator-source): hero, how it works, the
// 12-question audit, the optional ERO questions while the score is "calculated", results with the score ring,
// category breakdown and fee comparison, and the 6-step builder that ends in the $25 checkout.

type Props = { brandName: string; canBuy: boolean; cancelled: boolean; ourFee: number | null };
type Stage = "quiz" | "ero" | "results";
const CIRC = 534;

export function WispApp({ brandName, canBuy, cancelled, ourFee }: Props) {
  const [stage, setStage] = useState<Stage>("quiz");
  const [q, setQ] = useState(0);
  const [answers, setAnswers] = useState<(0 | 1 | 2 | null)[]>(() => QUESTIONS.map(() => null));
  const [eroStep, setEroStep] = useState(0);
  const [ero, setEro] = useState<EroAnswers>({});
  const [eroDraft, setEroDraft] = useState("");
  const [auditId, setAuditId] = useState<string | null>(null);
  const [showBuilder, setShowBuilder] = useState(cancelled);
  const builderRef = useRef<HTMLElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // The page loaded, so a later load failure in this tab may retry on its own again (see app/wisp/error.tsx).
  useEffect(() => { try { window.sessionStorage.removeItem("wisp-retried"); } catch { /* storage unavailable */ } }, []);

  // A link to #builder (from the shop, the nav, or a cancelled checkout) opens the builder once the page is shown.
  useEffect(() => {
    if (!cancelled && window.location.hash !== "#builder") return;
    const t = setTimeout(() => {
      setShowBuilder(true);
      builderRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 100);
    return () => clearTimeout(t);
  }, [cancelled]);

  const result = useMemo(() => calculateScore(answers), [answers]);

  function choose(i: 0 | 1 | 2) {
    const next = [...answers];
    next[q] = i;
    setAnswers(next);
    setTimeout(() => {
      if (q < QUESTIONS.length - 1) setQ(q + 1);
      else {
        setEroStep(0);
        setEroDraft(ero[ERO_QUESTIONS[0].id] ?? "");
        setStage("ero");
      }
    }, 280);
  }

  function nextEro(skip: boolean) {
    const cur = ERO_QUESTIONS[eroStep];
    const merged = skip || !eroDraft ? ero : { ...ero, [cur.id]: eroDraft };
    setEro(merged);
    if (eroStep < ERO_QUESTIONS.length - 1) {
      const nq = ERO_QUESTIONS[eroStep + 1];
      setEroStep(eroStep + 1);
      setEroDraft(merged[nq.id] ?? "");
      return;
    }
    setStage("results");
    setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    // Lead capture: the scores are saved on the server; the results never wait on it.
    void recordAuditAction({ answers, ero: merged }).then((r) => { if (r.ok) setAuditId(r.auditId); }).catch(() => undefined);
  }

  function openBuilder() {
    setShowBuilder(true);
    setTimeout(() => builderRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }

  return (
    <div className="wisp">
      <nav className="navbar">
        <div className="nav-inner">
          <a className="nav-brand" href="#top"><span className="brand-m">{brandName.charAt(0).toUpperCase()}</span><span className="brand-text">{brandName}</span></a>
          <div className="nav-links"><a href="#audit">Free Audit</a><a href="#how">How It Works</a><a href="#builder" onClick={openBuilder}>WISP Builder</a></div>
          <a className="btn btn-gold btn-sm" href="#audit">Start Free Audit</a>
        </div>
      </nav>

      <header className="hero" id="top">
        <div className="hero-glow" />
        <div className="hero-inner">
          <p className="hero-eyebrow">IRS COMPLIANCE TOOL FOR TAX PROFESSIONALS</p>
          <h1 className="hero-title">Do you have a <span className="gold-gradient-text">Written Information Security Plan?</span></h1>
          <p className="hero-sub">The IRS requires every tax preparer to have a WISP. Take our free 2-minute audit to find out where you stand — and what you&apos;re risking without one.</p>
          <p className="hero-disclaimer">{pageDisclaimer(brandName)}</p>
          <div className="hero-ctas"><a className="btn btn-gold btn-lg" href="#audit">Take the Free Audit</a><a className="btn btn-outline btn-lg" href="#how">How It Works</a></div>
          <div className="hero-stats">
            <div className="stat"><span className="stat-num">12</span><span className="stat-label">Compliance Questions</span></div>
            <div className="stat-divider" />
            <div className="stat"><span className="stat-num">4</span><span className="stat-label">Security Categories</span></div>
            <div className="stat-divider" />
            <div className="stat"><span className="stat-num">2<span className="stat-min">min</span></span><span className="stat-label">To Complete</span></div>
          </div>
        </div>
      </header>
      <hr className="gold-divider" />

      <section className="section" id="how">
        <div className="container">
          <p className="section-eyebrow">SIMPLE PROCESS</p>
          <h2 className="section-title">How it works</h2>
          <div className="steps-grid">
            {[
              ["01", "Take the Free Audit", "Answer 12 questions about your current data security practices. Takes about 2 minutes."],
              ["02", "Get Your Score", "Receive your 0–100 compliance score with a breakdown across 4 IRS security categories."],
              ["03", "Build Your WISP", "Use our guided builder to create your attorney-ready Written Information Security Plan for just $25."],
            ].map(([n, t, d]) => <div key={n} className="step-card"><div className="step-num">{n}</div><h3>{t}</h3><p>{d}</p></div>)}
          </div>
        </div>
      </section>
      <hr className="gold-divider" />

      <section className="section" id="audit">
        <div className="container">
          <p className="section-eyebrow">FREE COMPLIANCE CHECK</p>
          <h2 className="section-title">The WISP audit</h2>
          <p className="section-sub">Answer honestly. Your results are saved privately to help us follow up, and never shared or sold.</p>

          {stage === "quiz" && (
            <div className="quiz-container">
              <div className="quiz-progress-wrap">
                <div className="quiz-progress-label"><span>Question {q + 1} of {QUESTIONS.length}</span><span>{CATEGORIES[QUESTIONS[q].cat].name}</span></div>
                <div className="quiz-progress-track"><div className="quiz-progress-fill" style={{ width: `${(q / QUESTIONS.length) * 100}%` }} /></div>
              </div>
              <div className="quiz-card" key={q}>
                <p className="quiz-category">{CATEGORIES[QUESTIONS[q].cat].name}</p>
                <h3 className="quiz-question">{QUESTIONS[q].q}</h3>
                <div className="quiz-answers" role="radiogroup" aria-label={QUESTIONS[q].q}>
                  {QUESTIONS[q].answers.map((text, i) => (
                    <button key={text} type="button" role="radio" aria-checked={answers[q] === i} className={`quiz-answer${answers[q] === i ? " selected" : ""}`} onClick={() => choose(i as 0 | 1 | 2)}>
                      <span className="answer-dot" /><span>{text}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="quiz-nav"><button type="button" className="btn btn-outline btn-sm" disabled={q === 0} onClick={() => setQ(q - 1)}>← Back</button></div>
            </div>
          )}

          {stage === "ero" && (
            <div className="ero-interstitial">
              <div className="spinner" />
              <h3>Analyzing your responses…</h3>
              <p>Quick question {eroStep + 1} of {ERO_QUESTIONS.length} (optional — helps personalize your results)</p>
              <div className="ero-inputs">
                <div className="field">
                  <label htmlFor="ero-input">{ERO_QUESTIONS[eroStep].label}</label>
                  {ERO_QUESTIONS[eroStep].type === "select" ? (
                    <select id="ero-input" value={eroDraft} onChange={(e) => setEroDraft(e.target.value)}>
                      <option value="" disabled>Choose…</option>
                      {(ERO_QUESTIONS[eroStep] as { options: readonly string[] }).options.map((o) => <option key={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input id="ero-input" type="text" inputMode="decimal" autoComplete="off" value={eroDraft} placeholder={(ERO_QUESTIONS[eroStep] as { placeholder?: string }).placeholder} onChange={(e) => setEroDraft(numberDraft(e.target.value, true))} />
                  )}
                </div>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => nextEro(true)}>Skip</button>
              </div>
              <button type="button" className="btn btn-gold" onClick={() => nextEro(false)}>{eroStep < ERO_QUESTIONS.length - 1 ? "Continue →" : "See My Results →"}</button>
            </div>
          )}

          {stage === "results" && <Results brandName={brandName} refEl={resultsRef} score={result.score} breakdown={result.breakdown} ero={ero} ourFee={ourFee} onBuild={openBuilder} />}
        </div>
      </section>

      <section className={`section${showBuilder ? "" : " hidden"}`} id="builder" ref={builderRef}>
        <div className="container">
          <p className="section-eyebrow">GUIDED WISP CREATION</p>
          <h2 className="section-title">WISP builder</h2>
          <p className="section-sub">$25 — Complete your Written Information Security Plan in 6 guided steps.</p>
          {showBuilder && <Builder auditId={auditId} canBuy={canBuy} cancelled={cancelled} />}
        </div>
      </section>

      <footer className="footer">
        <div className="footer-brand"><span className="brand-m">{brandName.charAt(0).toUpperCase()}</span><span className="brand-text">{brandName}</span></div>
        <p>{DISCLAIMER}</p>
        <p>The IRS requires tax professionals to create and maintain a written information security plan (IRS Publication 5708; FTC Safeguards Rule).</p>
      </footer>
    </div>
  );
}

function Results({ brandName, refEl, score, breakdown, ero, ourFee, onBuild }: { brandName: string; refEl: React.RefObject<HTMLDivElement | null>; score: number; breakdown: Record<string, number>; ero: EroAnswers; ourFee: number | null; onBuild: () => void }) {
  const [shown, setShown] = useState(0);
  const [offset, setOffset] = useState(CIRC);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setOffset(CIRC - (CIRC * score) / 100));
    let n = 0;
    const timer = setInterval(() => {
      n = Math.min(score, n + Math.max(1, Math.round(score / 40)));
      setShown(n);
      if (n >= score) clearInterval(timer);
    }, 30);
    return () => { cancelAnimationFrame(raf); clearInterval(timer); };
  }, [score]);
  const verdict = scoreVerdict(score);
  const fee = feeComparison(ero, ourFee);
  return (
    <div className="results-container" ref={refEl}>
      <div className="score-display">
        <div className="score-ring">
          <svg className="score-svg" viewBox="0 0 200 200" aria-hidden="true">
            <defs><linearGradient id="wispGoldGrad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#BF953F" /><stop offset="50%" stopColor="#FCF6BA" /><stop offset="100%" stopColor="#B38728" /></linearGradient></defs>
            <circle className="score-bg" cx="100" cy="100" r="85" />
            <circle className="score-fill" cx="100" cy="100" r="85" style={{ strokeDashoffset: offset }} />
          </svg>
          <div className="score-number" aria-label={`Score ${score} out of 100`}><span>{shown}</span><span className="score-max">/100</span></div>
        </div>
        <h3 className={`score-headline ${verdict.tone}`}>{verdict.headline}</h3>
        <p className="score-subtext">{verdict.text}</p>
      </div>
      <div className="category-breakdown">
        {CATEGORY_KEYS.map((c) => (
          <div key={c} className="cat-card">
            <h4>{CATEGORIES[c].name}</h4>
            <div className="cat-score">{breakdown[c]}%</div>
            <div className="cat-bar"><div className="cat-bar-fill" style={{ width: `${breakdown[c]}%` }} /></div>
            <p className="cat-rec">{breakdown[c] < 70 ? CATEGORY_ADVICE[c] : "On track — document it in your WISP."}</p>
          </div>
        ))}
      </div>
      {fee && (
        <div className="fee-comparison">
          <h3>YOUR CURRENT COSTS vs {brandName.split(" ")[0].toUpperCase()}</h3>
          <div className="fee-grid">
            <div className="fee-card"><p className="fee-label">Your per-return cost</p><p className="fee-num">${fee.theirFee.toLocaleString("en-US")}</p></div>
            <div className={`fee-card${fee.lower ? "" : " highlight"}`}><p className="fee-label">{brandName.split(" ")[0]} all-in per funded return</p><p className="fee-num gold">${fee.ourFee.toLocaleString("en-US")}</p></div>
          </div>
          <p className="fee-note">{fee.note}</p>
        </div>
      )}
      <div className="results-cta">
        <h3>READY TO FIX THIS?</h3>
        <p>Our guided builder walks you through creating your complete, attorney-ready Written Information Security Plan.</p>
        <button type="button" className="btn btn-gold btn-lg" onClick={onBuild}>Build My WISP — $25</button>
        <p className="fine-print">Attorney-ready means professionally formatted for attorney review. This tool provides general guidance, not legal advice.</p>
      </div>
    </div>
  );
}

function Builder({ auditId, canBuy, cancelled }: { auditId: string | null; canBuy: boolean; cancelled: boolean }) {
  const [step, setStep] = useState(0);
  const [data, setData] = useState<WispAnswers>({});
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [email, setEmail] = useState("");
  const [accept, setAccept] = useState(false);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(cancelled ? "Checkout was cancelled, so you haven't been charged. Your answers are still here if you'd like to finish." : null);
  const [emailError, setEmailError] = useState(false);
  const cur = BUILDER_STEPS[step];
  const restored = useRef(false);

  // Keep a draft in this browser so a refresh (or a cancelled checkout) doesn't lose the answers.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const saved = JSON.parse(window.sessionStorage.getItem("wisp-builder") ?? "null") as { data?: WispAnswers; email?: string } | null;
        if (saved?.data) setData(saved.data);
        if (saved?.email) setEmail(saved.email);
      } catch { /* no saved draft */ }
      restored.current = true;
    }, 0);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    // Saving before the draft is read would overwrite it with the empty form.
    if (!restored.current) return;
    try { window.sessionStorage.setItem("wisp-builder", JSON.stringify({ data, email })); } catch { /* storage unavailable */ }
  }, [data, email]);

  const fields = cur.id === "review" ? [] : BUILDER_FIELDS[cur.id];
  function go(dir: 1 | -1) {
    if (dir === 1) {
      const bad: Record<string, boolean> = {};
      for (const f of fields) if (f.required && !(data[f.id] ?? "").trim()) bad[f.id] = true;
      setErrors(bad);
      if (Object.keys(bad).length) return;
    }
    setStep(Math.max(0, Math.min(BUILDER_STEPS.length - 1, step + dir)));
    document.getElementById("builder")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function complete() {
    const e = email.trim();
    if (!EMAIL.test(e)) { setEmailError(true); return; }
    setEmailError(false);
    if (!ack) { setProblem("Please tick the box to confirm you understand the purchase terms."); return; }
    if (!accept) { setProblem("Please confirm that you accept the Terms of Service and the Refund Policy."); return; }
    setBusy(true);
    setProblem(null);
    try {
      // On success the server sends the browser to Stripe; only a problem comes back here.
      const r = await startWispCheckoutAction({ answers: data, email: e, auditId, acceptTerms: accept, acknowledgePurchase: ack });
      if (r && !r.ok) {
        setProblem(r.error);
        if (r.field === "delivery_email") setEmailError(true);
      }
    } catch {
      setProblem("The connection was interrupted. Your answers are still here; please try again.");
    } finally {
      setBusy(false);
    }
  }

  const rows = Object.values(BUILDER_FIELDS).flat().filter((f) => f.required || data[f.id]);
  return (
    <div className="builder-layout">
      <aside className="builder-sidebar">
        <div className="builder-steps">
          {BUILDER_STEPS.map((s, i) => (
            <button key={s.id} type="button" className={`builder-step${i === step ? " active" : ""}${i < step ? " done" : ""}`} onClick={() => { if (i <= step) setStep(i); }} aria-current={i === step ? "step" : undefined}>
              <span className="step-indicator">{i < step ? "✓" : i + 1}</span>
              <span className="step-label">{s.title}<small>{s.sub}</small></span>
            </button>
          ))}
        </div>
      </aside>
      <div className="builder-main">
        <div className="builder-panel" key={cur.id}>
          {problem && <p className="alert" role="alert">{problem}</p>}
          {cur.id !== "review" ? (
            <>
              <h3>{cur.title}</h3>
              <p className="panel-desc">{cur.sub}. Fill in each field — this becomes part of your finished WISP document.</p>
              <div className="builder-fields">
                {fields.map((f) => (
                  <div key={f.id} className="field">
                    <label htmlFor={`bf_${f.id}`}>{f.label}{f.required ? " *" : ""}</label>
                    {f.type === "textarea" ? (
                      <textarea id={`bf_${f.id}`} maxLength={4000} placeholder={f.placeholder} value={data[f.id] ?? ""} onChange={(e) => setData({ ...data, [f.id]: e.target.value })} aria-invalid={!!errors[f.id]} />
                    ) : f.type === "select" ? (
                      <select id={`bf_${f.id}`} value={data[f.id] ?? ""} onChange={(e) => setData({ ...data, [f.id]: e.target.value })} aria-invalid={!!errors[f.id]}>
                        <option value="" disabled>Choose…</option>
                        {f.options!.map((o) => <option key={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input id={`bf_${f.id}`} type={f.type === "number" ? "text" : f.type} inputMode={f.type === "number" ? "numeric" : undefined} maxLength={200} placeholder={f.placeholder} value={data[f.id] ?? ""} onChange={(e) => setData({ ...data, [f.id]: f.type === "number" ? numberDraft(e.target.value, false) : e.target.value })} aria-invalid={!!errors[f.id]} />
                    )}
                    {errors[f.id] && <p className="field-error">This field is required.</p>}
                  </div>
                ))}
              </div>
              <div className="builder-nav">
                <button type="button" className="btn btn-outline" disabled={step === 0} onClick={() => go(-1)}>← Back</button>
                <button type="button" className="btn btn-gold" onClick={() => go(1)}>Continue →</button>
              </div>
            </>
          ) : (
            <>
              <h3>Review &amp; finalize</h3>
              <p className="panel-desc">Confirm your details below. Your WISP will be generated as a professional PDF.</p>
              <div className="review-box">
                <h4>Your information</h4>
                {rows.map((f) => <div key={f.id} className="review-row"><span className="rk">{f.label}</span><span className="rv">{data[f.id]?.trim() || "— missing, go back to fill this in"}</span></div>)}
              </div>
              <div className="email-capture">
                <h4>DELIVERY EMAIL</h4>
                <p>Where should we send your completed WISP? After payment you can download it right away, and we&apos;ll email you a copy.</p>
                <div className="field">
                  <label htmlFor="delivery_email">Email address *</label>
                  <input id="delivery_email" type="email" autoComplete="email" value={email} placeholder="you@yourfirm.com" onChange={(e) => setEmail(e.target.value)} aria-invalid={emailError} />
                  {emailError && <p className="field-error">Please enter a valid email address.</p>}
                </div>
                <label className="check-field"><input type="checkbox" required checked={ack} onChange={(e) => setAck(e.target.checked)} /> <span>{PURCHASE_ACK}</span></label>
                {canBuy && <label className="check-field"><input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} /> <span>I have read and accept <TermsLinks />.</span></label>}
              </div>
              <div className="builder-nav">
                <button type="button" className="btn btn-outline" onClick={() => go(-1)}>← Back</button>
                <button type="button" className="btn btn-gold" onClick={complete} disabled={busy || !canBuy || !ack}>{busy ? "Opening secure checkout…" : "Complete My WISP — $25"}</button>
              </div>
              {!canBuy && <p className="fine-print">Online checkout isn&apos;t available yet. Please contact us to get your WISP.</p>}
              <p className="fine-print" style={{ marginTop: 16 }}>Secure payment by Stripe. {DISCLAIMER}</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
