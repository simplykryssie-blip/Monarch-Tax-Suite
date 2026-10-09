"use client";

import { useEffect, useMemo, useState } from "react";
import { CALCULATOR_TAX_YEARS } from "@/lib/calculator/years";
import { LeadForm, type LeadCaptureConfig } from "./lead-form";

type Filing = "single" | "married" | "head" | "separate";
type FieldProps = { label: string; value: string; onChange: (value: string) => void; hint?: string };
const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number.isFinite(value) ? value : 0);
const filingLabels: Record<Filing, string> = { single: "Single", married: "Married filing jointly", head: "Head of household", separate: "Married filing separately" };
type TaxYear = "2025" | "2026";

// 2025: Rev. Proc. 2024-40 as amended by P.L. 119-21. 2026: Rev. Proc. 2025-32.
const standardDeductions: Record<TaxYear, Record<Filing, number>> = {
  "2025": { single: 15750, married: 31500, head: 23625, separate: 15750 },
  "2026": { single: 16100, married: 32200, head: 24150, separate: 16100 },
};
// Upper limit of each bracket; the last bracket is unbounded.
const RATES = [.10, .12, .22, .24, .32, .35, .37];
const bracketLimits: Record<TaxYear, Record<Filing, number[]>> = {
  "2025": {
    single: [11925, 48475, 103350, 197300, 250525, 626350, Infinity],
    married: [23850, 96950, 206700, 394600, 501050, 751600, Infinity],
    head: [17000, 64850, 103350, 197300, 250500, 626350, Infinity],
    separate: [11925, 48475, 103350, 197300, 250525, 375800, Infinity],
  },
  "2026": {
    single: [12400, 50400, 105700, 201775, 256225, 640600, Infinity],
    married: [24800, 100800, 211400, 403550, 512450, 768700, Infinity],
    head: [17700, 67450, 105700, 201750, 256200, 640600, Infinity],
    separate: [12400, 50400, 105700, 201775, 256225, 384350, Infinity],
  },
};
// Child Tax Credit: $2,200 per qualifying child, up to $1,700 refundable (ACTC),
// reduced $50 per $1,000 of income over $400,000 (MFJ) / $200,000 (all others).
const CTC_PER_CHILD = 2200;
const ACTC_PER_CHILD = 1700;
const ctcPhaseoutStart = (filing: Filing) => (filing === "married" ? 400000 : 200000);
function Field({label,value,onChange,hint,prefix="$"}:FieldProps&{prefix?:string}){return <label className="mt-field"><span>{label}</span><div className="mt-input-wrap">{prefix&&<span>{prefix}</span>}<input inputMode="decimal" value={value} onChange={e=>onChange(e.target.value.replace(/[^0-9.]/g,""))} placeholder="0" /></div>{hint&&<small>{hint}</small>}</label>}
function taxFromBrackets(taxable:number, filing:Filing, year:TaxYear){let tax=0,prior=0;for(let i=0;i<RATES.length;i++){const limit=bracketLimits[year][filing][i];if(taxable<=prior)break;tax+=(Math.min(taxable,limit)-prior)*RATES[i];prior=limit;}return tax;}
function marginalRate(taxable:number, filing:Filing, year:TaxYear){const i=bracketLimits[year][filing].findIndex(limit=>taxable<=limit);return RATES[i<0?RATES.length-1:i];}
/** The Basic Tax Calculator: plain black and white, with no company name or branding, so it can sit on any customer site. `embedded` adds height reporting for iframe installs; `leadCapture` (licensed embeds only) adds the buyer's optional lead form. */
export function BasicCalculator({embedded=false,maxTaxYear,leadCapture}:{embedded?:boolean;maxTaxYear?:number;leadCapture?:LeadCaptureConfig}){
 const years=CALCULATOR_TAX_YEARS.filter(y=>maxTaxYear===undefined||y<=maxTaxYear).map(String) as TaxYear[];
 const newest=years[0]??"2025";
 const [year,setYear]=useState<TaxYear>(newest);
 const [filing,setFiling]=useState<Filing>("single");
 const [income,setIncome]=useState("");
 const [otherIncome,setOtherIncome]=useState("");
 const [deductions,setDeductions]=useState("");
 const [withholding,setWithholding]=useState("");
 const [credits,setCredits]=useState("");
 const [useStandard,setUseStandard]=useState(true);
 const [children,setChildren]=useState("");
 const result=useMemo(()=>{
  const n=(s:string)=>Math.max(0,Number(s)||0);
  const gross=n(income)+n(otherIncome);
  const deduction=useStandard?standardDeductions[year][filing]:n(deductions);
  const taxable=Math.max(0,gross-deduction);
  const estimatedTax=taxFromBrackets(taxable,filing,year);
  const childCount=Math.min(20,Math.floor(n(children)));
  const ctcReduction=Math.ceil(Math.max(0,gross-ctcPhaseoutStart(filing))/1000)*50;
  const ctcTotal=Math.max(0,childCount*CTC_PER_CHILD-ctcReduction);
  const ctcNonrefundable=Math.min(ctcTotal,estimatedTax);
  const otherCredits=Math.min(n(credits),estimatedTax-ctcNonrefundable);
  const taxAfterCredits=estimatedTax-ctcNonrefundable-otherCredits;
  const ctcRefundable=Math.min(ctcTotal-ctcNonrefundable,childCount*ACTC_PER_CHILD,Math.max(0,(n(income)-2500)*.15));
  const totalTax=taxAfterCredits-ctcRefundable;
  const balance=n(withholding)-totalTax;
  return {gross,deduction,taxable,estimatedTax,ctcNonrefundable,ctcRefundable,otherCredits,taxAfterCredits,totalTax,balance,childCount,marginal:marginalRate(taxable,filing,year)};
 },[income,otherIncome,deductions,withholding,credits,filing,useStandard,children,year]);
 const reset=()=>{setYear(newest);setFiling("single");setIncome("");setOtherIncome("");setDeductions("");setWithholding("");setCredits("");setUseStandard(true);setChildren("");};
 // In an iframe, report content height so host pages that listen can resize the frame.
 useEffect(()=>{if(!embedded||typeof window==="undefined"||window.parent===window)return;const send=()=>window.parent.postMessage({type:"monarch-calculator:height",height:document.documentElement.scrollHeight},"*");send();const ro=new ResizeObserver(send);ro.observe(document.body);return()=>ro.disconnect();},[embedded]);
 return <main className={"mt-shell"+(embedded?" mt-embedded":"")}>
   <section className="mt-hero"><h1>Estimate your federal tax</h1><p>Explore an approximate federal income tax outcome using your income, deduction, credits, and withholding.</p><div className="mt-year">Tax year {year} · Filed in {Number(year)+1} · Federal estimate</div></section>
  <div className="mt-layout">
   <section className="mt-form-card"><div className="mt-card-head"><div><span className="mt-step">YOUR DETAILS</span><h2>Build your estimate</h2></div><button className="mt-reset" onClick={reset}>Reset ↺</button></div>
    <div className="mt-two"><label className="mt-field"><span>Tax year</span><select value={year} onChange={e=>setYear(e.target.value as TaxYear)}>{years.map(y=><option key={y} value={y}>{y} (filed in {Number(y)+1})</option>)}</select></label><label className="mt-field"><span>Filing status</span><select value={filing} onChange={e=>setFiling(e.target.value as Filing)}>{Object.entries(filingLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label></div>
    <div className="mt-two"><Field label="Wages and earned income" value={income} onChange={setIncome} hint="Total taxable wages / earned income"/><Field label="Other taxable income" value={otherIncome} onChange={setOtherIncome} hint="Interest or other taxable income"/></div>
    <div className="mt-deduction-head"><span className="mt-section-label">DEDUCTION</span><div className="mt-toggle"><button className={useStandard?"selected":""} onClick={()=>setUseStandard(true)}>Standard</button><button className={!useStandard?"selected":""} onClick={()=>setUseStandard(false)}>Other amount</button></div></div>
    {useStandard?<div className="mt-standard"><span>{year} standard deduction</span><b>{money(standardDeductions[year][filing])}</b></div>:<Field label="Deduction amount" value={deductions} onChange={setDeductions} hint="Enter the deduction amount you expect to claim"/>}
    <div className="mt-two"><Field label="Federal income tax withheld" value={withholding} onChange={setWithholding} hint="Year-to-date / expected total"/><Field label="Qualifying children under 17" value={children} onChange={setChildren} prefix="" hint={`Child Tax Credit up to ${money(CTC_PER_CHILD)} per child`}/></div>
    <Field label="Other estimated tax credits" value={credits} onChange={setCredits} hint="Other nonrefundable credits you reasonably expect to qualify for (e.g. education, dependent care)"/>
    <div className="mt-info"><span>ⓘ</span><p>This basic estimator uses federal ordinary-income brackets and a deduction amount. The Child Tax Credit includes the income phaseout and refundable limit; other credits are entered manually and their eligibility is not verified.</p></div>
   </section>
   <aside className="mt-results"><div className="mt-result-top"><span className="mt-step">YOUR ESTIMATE</span><span className="mt-live"><i/> UPDATING LIVE</span></div><div className="mt-result-label">{result.balance>=0?"Potential refund":"Potential amount owed"}</div><div className={"mt-result-amount "+(result.balance<0?"owed":"")}>{money(Math.abs(result.balance))}</div><p className="mt-result-caption">Estimated withholding compared with estimated federal income tax.</p><div className="mt-rule"/>
    <div className="mt-breakdown"><div><span>Total income entered</span><b>{money(result.gross)}</b></div><div><span>Deduction used</span><b>− {money(result.deduction)}</b></div><div><span>Estimated taxable income</span><b>{money(result.taxable)}</b></div><div><span>Estimated tax before credits</span><b>{money(result.estimatedTax)}</b></div><div><span>Child Tax Credit</span><b>− {money(result.ctcNonrefundable)}</b></div><div><span>Other credits</span><b>− {money(result.otherCredits)}</b></div><div><span>Estimated federal tax</span><b>{money(result.taxAfterCredits)}</b></div>{result.ctcRefundable>0&&<div><span>Refundable child credit</span><b>+ {money(result.ctcRefundable)}</b></div>}<div><span>Federal withholding</span><b>{money(Number(withholding)||0)}</b></div></div>
    <div className="mt-result-foot"><span>Effective tax rate</span><b>{result.gross>0?((Math.max(0,result.totalTax)/result.gross)*100).toFixed(1):"0.0"}%</b></div><div className="mt-result-foot mt-result-foot-sub"><span>Marginal tax bracket</span><b>{Math.round(result.marginal*100)}%</b></div>
   </aside>
  </div>
  {leadCapture&&<div className="mt-lead-wrap"><LeadForm config={leadCapture} summary={{taxYear:Number(year),filingStatus:filing,result:result.balance>=0?"refund":"owed",amount:Math.abs(result.balance)}}/></div>}
  <section className="mt-disclaimer"><b>IMPORTANT — ESTIMATE ONLY</b><p>This is an educational estimate, not tax advice, tax preparation, or a guarantee of a refund. It uses the selected year’s (2025 or 2026) federal ordinary-income tax brackets, standard deduction amounts, and a simplified Child Tax Credit, and does not fully calculate filing eligibility, dependent qualification, earned income credit, the new tips/overtime/senior/car-loan deductions, self-employment tax, Social Security/Medicare taxes, capital gains, AMT, itemized deduction limits, additional deductions, state/local taxes, penalties, or other special rules. Actual results can differ materially. Verify against current IRS instructions or consult a qualified tax professional before making decisions. Do not enter Social Security numbers or other sensitive personal information.</p><a href="https://www.irs.gov/filing/federal-income-tax-rates-and-brackets" target="_blank" rel="noreferrer">Review IRS tax-rate guidance ↗</a></section>
  <style jsx global>{`
  .mt-shell{min-height:100vh;background:#fff;color:#000;font-family:Arial,Helvetica,sans-serif}.mt-embedded{min-height:0}
  .mt-hero{padding:36px 22px 20px;text-align:center}.mt-hero h1{font-weight:700;font-size:clamp(28px,5vw,40px);letter-spacing:-.5px;line-height:1.1;margin:0 0 12px}.mt-hero p{max-width:590px;margin:0 auto;color:#333;font-size:15px;line-height:1.6}.mt-year{margin-top:14px;color:#555;font-size:12px}.mt-step,.mt-section-label{font-size:10px;font-weight:700;letter-spacing:2px;color:#000;text-transform:uppercase}
  .mt-layout{width:min(1140px,calc(100% - 36px));margin:24px auto;display:grid;grid-template-columns:minmax(0,1.2fr) minmax(330px,.8fr);gap:22px;align-items:start}.mt-form-card,.mt-results{border:1px solid #000;border-radius:4px;background:#fff}.mt-form-card{padding:26px}.mt-card-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:23px}.mt-card-head h2{font-weight:700;font-size:24px;margin:8px 0 0}.mt-reset{background:transparent;border:0;color:#000;font-size:12px;text-decoration:underline;cursor:pointer}.mt-field{display:flex;flex-direction:column;gap:8px;min-width:0;margin-bottom:18px}.mt-field>span{font-size:12px;font-weight:700;color:#000}.mt-field small{font-size:11px;line-height:1.4;color:#555}.mt-field input,.mt-field select{width:100%;height:46px;border:1px solid #000;border-radius:3px;background:#fff;padding:0 12px;color:#000;font-size:14px;min-width:0}.mt-field select{appearance:auto}.mt-input-wrap{height:46px;display:flex;align-items:center;border:1px solid #000;border-radius:3px;padding-left:12px;color:#000}.mt-input-wrap input{border:0;height:43px;padding-left:8px;outline:none}.mt-input-wrap:focus-within,.mt-field select:focus{outline:2px solid #000;outline-offset:2px}.mt-two{display:grid;grid-template-columns:1fr 1fr;gap:14px}.mt-deduction-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:3px 0 14px}.mt-toggle{display:flex;border:1px solid #000;border-radius:3px;overflow:hidden}.mt-toggle button{border:0;padding:8px 10px;background:#fff;color:#000;font-size:11px;cursor:pointer}.mt-toggle button.selected{background:#000;color:#fff}.mt-standard{display:flex;justify-content:space-between;align-items:center;padding:15px;border:1px solid #000;border-radius:3px;margin-bottom:18px;font-size:12px}.mt-standard b{font-size:19px}.mt-info{display:flex;gap:10px;border:1px solid #bbb;border-radius:3px;padding:12px}.mt-info>span{font-size:17px}.mt-info p{font-size:11px;line-height:1.6;margin:0;color:#333}
  .mt-results{padding:26px;background:#000;color:#fff;position:sticky;top:20px}.mt-result-top{display:flex;justify-content:space-between;align-items:center;gap:12px}.mt-result-top .mt-step{color:#fff}.mt-live{display:flex;align-items:center;gap:6px;color:#ccc;font-size:9px;letter-spacing:1px}.mt-live i{width:6px;height:6px;border-radius:50%;background:#fff}.mt-result-label{margin-top:30px;font-size:13px;color:#ddd}.mt-result-amount{font-size:clamp(42px,4.5vw,57px);font-weight:700;letter-spacing:-1.5px;color:#fff;margin-top:7px;overflow-wrap:anywhere}.mt-result-caption{font-size:11px;color:#bbb;line-height:1.6;margin:7px 0 22px}.mt-rule{height:1px;background:#555}.mt-breakdown{padding:13px 0}.mt-breakdown>div{display:flex;justify-content:space-between;gap:15px;padding:9px 0;font-size:12px;color:#ddd}.mt-breakdown>div b{color:#fff;font-size:12px;white-space:nowrap}.mt-breakdown>div:nth-child(3),.mt-breakdown>div:nth-child(7){border-top:1px solid #555;padding-top:13px;margin-top:3px}.mt-result-foot{border-top:1px solid #555;padding-top:17px;display:flex;justify-content:space-between;align-items:center;color:#ddd;font-size:12px}.mt-result-foot b{font-size:15px;color:#fff}.mt-result-foot-sub{border-top:0;padding-top:10px}
  .mt-disclaimer{width:min(1096px,calc(100% - 36px));margin:0 auto 25px;border:1px solid #000;padding:20px 22px;border-radius:3px}.mt-disclaimer>b{font-size:10px;letter-spacing:1.5px}.mt-disclaimer p{font-size:11px;line-height:1.8;color:#333;margin:9px 0}.mt-disclaimer a{color:#000;font-size:11px;font-weight:700}
  .mt-lead-wrap{width:min(1096px,calc(100% - 36px));margin:0 auto 22px}.mt-lead{border:1px solid #000;border-radius:4px;background:#fff;padding:24px 26px}.mt-lead h2{font-size:22px;margin:8px 0 6px;color:#000}.mt-lead-sub{font-size:12px;line-height:1.6;color:#333;margin:0 0 14px}.mt-hp{position:absolute;left:-9999px;width:1px;height:1px;opacity:0}.mt-consent{display:flex;gap:10px;align-items:flex-start;font-size:12px;line-height:1.6;color:#000;margin:6px 0 14px}.mt-consent input{margin-top:3px}.mt-lead-error{color:#000;font-weight:700;font-size:12px;margin:0 0 10px}.mt-lead-submit{background:#000;color:#fff;border:0;border-radius:3px;padding:13px 20px;font-weight:700;font-size:14px;cursor:pointer}.mt-lead-submit:disabled{opacity:.7;cursor:wait}
  @media(max-width:800px){.mt-lead-wrap{width:calc(100% - 28px)}.mt-layout{grid-template-columns:1fr;width:min(620px,calc(100% - 28px));margin:18px auto}.mt-results{position:static;grid-row:1}.mt-form-card{padding:21px}.mt-hero{padding:28px 18px 14px}.mt-hero p{font-size:13px}.mt-disclaimer{width:calc(100% - 28px)}.mt-result-amount{font-size:49px}}
  @media(max-width:480px){.mt-hero h1{font-size:28px}.mt-two{grid-template-columns:1fr;gap:0}.mt-results{padding:21px}.mt-form-card{padding:18px}.mt-deduction-head{align-items:flex-start;flex-direction:column}}
  `}</style>
 </main>;
}
