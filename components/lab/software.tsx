"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import {
  compute, diagnostics, EIC_RELATIONSHIPS, EXPENSE_KEYS, EXPENSE_LABELS, FILING_STATUSES, fmt, LINES, n,
  type Computed, type Diagnostic, type TaxReturn,
} from "@/lib/lab/engine";

// The Monarch Tax Lab practice software: a desktop-style return-entry window (title bar, toolbar, form tree, entry
// grid, live status bar). Used by students on a scenario and by instructors to prepare an answer key. It only edits a
// return in memory; saving and checking happen in the parent through server actions.

const FS_NAME = Object.fromEntries(FILING_STATUSES) as Record<string, string>;
const RELS = [...EIC_RELATIONSHIPS, "Parent", "Grandparent", "Aunt", "Uncle", "Other relative", "Not related"];
type FormId = string;
const SECTIONS: { id: string; label: string; forms: [FormId, string][] | null }[] = [
  { id: "basic", label: "Basic Information", forms: [["fs", "Filing status"], ["tp", "Taxpayer information"], ["sp", "Spouse information"], ["addr", "Address & contact"], ["deps", "Dependents"]] },
  { id: "income", label: "Income", forms: [["w2", "Wages (Form W-2)"], ["int", "Interest (1099-INT)"], ["div", "Dividends (1099-DIV)"], ["g", "Unemployment (1099-G)"], ["r", "Retirement distributions (1099-R)"], ["ssa", "Social Security (SSA-1099)"], ["schc", "Business income (Schedule C)"], ["capg", "Capital gains & losses (1099-B)"], ["other", "Other income"]] },
  { id: "ded", label: "Deductions", forms: [["adj", "Adjustments to income"], ["item", "Standard or itemized"], ["s1a", "Schedule 1-A: seniors, tips, overtime, car loan"]] },
  { id: "cred", label: "Credits", forms: [["ctc", "Child tax credit"], ["eic", "Earned income credit"], ["dc", "Child & dependent care"], ["ed", "Education credits"], ["ocred", "Other credits"]] },
  { id: "health", label: "Health Insurance", forms: [["aca", "Coverage & Form 1095-A"]] },
  { id: "misc", label: "Miscellaneous", forms: [["est", "Estimated payments"], ["applyn", "Apply refund to 2027"]] },
  { id: "sum", label: "Summary / Print", forms: null },
  { id: "efile", label: "E-File", forms: null },
];
const DIAG_GO: Record<string, [string, FormId | null]> = {
  "Filing status": ["basic", "fs"], "Taxpayer information": ["basic", "tp"], "Spouse information": ["basic", "sp"], "Address & contact": ["basic", "addr"],
  Dependents: ["basic", "deps"], "Form W-2": ["income", "w2"], "1099-R": ["income", "r"], Refund: ["efile", null], Signature: ["efile", null], Calculation: ["sum", null],
};
const NEW_ITEM: Record<string, () => Record<string, unknown>> = {
  deps: () => ({ name: "", ssnNum: "", rel: "Son", age: "", months: "12", ssn: true, student: false, disabled: false }),
  w2: () => ({ employer: "", ein: "", who: "tp", wages: "", fedwh: "" }),
  int: () => ({ payer: "", amt: "", fedwh: "", exempt: "" }),
  div: () => ({ payer: "", ord: "", qual: "", capd: "", fedwh: "" }),
  g: () => ({ payer: "", unemp: "", fedwh: "" }),
  r: () => ({ payer: "", gross: "", taxable: "", fedwh: "", code: "", ira: false }),
  ssa: () => ({ who: "tp", net: "", fedwh: "" }),
  schc: () => ({ name: "", who: "tp", receipts: "" }),
  capg: () => ({ desc: "", st: "", lt: "" }),
  "cred.ed": () => ({ name: "", type: "aotc", exp: "" }),
};

function getIn(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), obj);
}
function setIn<T>(obj: T, path: string[], value: unknown): T {
  const [k, ...rest] = path;
  if (Array.isArray(obj)) {
    const copy = [...obj];
    copy[Number(k)] = rest.length ? setIn(copy[Number(k)], rest, value) : value;
    return copy as T;
  }
  const o = (obj ?? {}) as Record<string, unknown>;
  return { ...o, [k]: rest.length ? setIn(o[k], rest, value) : value } as T;
}

type Ctx = { ret: TaxReturn; c: Computed; set: (path: string, v: unknown) => void; ent: Record<string, number>; setEnt: (list: string, i: number) => void };
const SW = createContext<Ctx | null>(null);
const useSW = () => useContext(SW)!;

function Lbl({ label, hint }: { label: string; hint?: string }) {
  return <span>{label}{hint ? <span className="hint"> {hint}</span> : null}</span>;
}
function Txt({ p, label, hint, mode }: { p: string; label: string; hint?: string; mode?: "numeric" | "tel" | "email" }) {
  const { ret, set } = useSW();
  return <label className="f"><Lbl label={label} hint={hint} /><input type="text" inputMode={mode} autoComplete="off" value={String(getIn(ret, p) ?? "")} onChange={(e) => set(p, e.target.value)} /></label>;
}
function Money({ p, label, hint }: { p: string; label: string; hint?: string }) {
  const { ret, set } = useSW();
  return <label className="f"><Lbl label={label} hint={hint} /><input type="text" inputMode="decimal" className="money" placeholder="0" autoComplete="off" value={String(getIn(ret, p) ?? "")} onChange={(e) => set(p, e.target.value)} /></label>;
}
function Sel({ p, label, opts }: { p: string; label: string; opts: [string, string][] }) {
  const { ret, set } = useSW();
  return <label className="f"><Lbl label={label} /><select value={String(getIn(ret, p) ?? "")} onChange={(e) => set(p, e.target.value)}>{opts.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>;
}
function Chk({ p, label }: { p: string; label: string }) {
  const { ret, set } = useSW();
  return <label className="check"><input type="checkbox" checked={getIn(ret, p) === true} onChange={(e) => set(p, e.target.checked)} />{label}</label>;
}
const Rows = ({ children }: { children: ReactNode }) => <div className="rows">{children}</div>;
function calcVal(key: string, c: Computed): string {
  if (key in c.lines) return fmt(c.lines[key as keyof Computed["lines"]]);
  if (key.startsWith("net-")) return fmt(c.d.biz[Number(key.slice(4))]?.net ?? 0);
  if (key === "kids" || key === "others" || key === "eicKids") return String(c.d[key]);
  if (key === "se") return fmt(c.d.seTax);
  const v = (c.d as Record<string, unknown>)[key];
  return fmt(typeof v === "number" ? v : 0);
}
function Calcs({ rows }: { rows: [string, string][] }) {
  const { c } = useSW();
  return <div className="calcs">{rows.map(([l, k]) => <div className="calc" key={k}><span>{l}</span><b>{calcVal(k, c)}</b></div>)}</div>;
}
function Head({ fno, title, help }: { fno: string; title: string; help?: string }) {
  return <div className="shead"><span className="fno">{fno}</span><h2>{title}</h2>{help ? <p className="lab-muted lab-small">{help}</p> : null}</div>;
}
function Who({ list, i }: { list: string; i: number }) {
  const { ret } = useSW();
  return ret.fs === "mfj" ? <Sel p={`${list}.${i}.who`} label="Belongs to" opts={[["tp", "Taxpayer"], ["sp", "Spouse"]]} /> : null;
}

/** One entry at a time behind numbered entry tabs. */
function Entries({ list, title, addLabel, children }: { list: string; title: string; addLabel: string; children: (p: string, i: number) => ReactNode }) {
  const { ret, set, ent, setEnt } = useSW();
  const arr = (getIn(ret, list) as unknown[]) ?? [];
  const add = () => { set(list, [...arr, NEW_ITEM[list]()]); setEnt(list, arr.length); };
  const addBtn = <button type="button" className="etab add" onClick={add}>+ {addLabel}</button>;
  if (!arr.length) return <><div className="etabs">{addBtn}</div><div className="noent">No {title} entries yet. Use “{addLabel}” to start one.</div></>;
  const i = Math.min(ent[list] ?? 0, arr.length - 1);
  const remove = () => { set(list, arr.filter((_, k) => k !== i)); setEnt(list, Math.max(0, i - 1)); };
  return (
    <>
      <div className="etabs" role="tablist">
        {arr.map((_, k) => <button type="button" key={k} role="tab" className="etab" aria-selected={k === i} onClick={() => setEnt(list, k)}>{title} {k + 1}</button>)}
        {addBtn}
      </div>
      <div className="entry">
        <div className="eh"><h3>{title} {i + 1} of {arr.length}</h3><button type="button" className="lab-btn sm danger" onClick={remove}>Delete entry</button></div>
        {children(`${list}.${i}.`, i)}
      </div>
    </>
  );
}

function Person({ pre }: { pre: "tp" | "sp" }) {
  return (
    <>
      <Rows>
        <Txt p={`${pre}.first`} label="First name" />
        <Txt p={`${pre}.mi`} label="Middle initial" />
        <Txt p={`${pre}.last`} label="Last name" />
        <Txt p={`${pre}.ssn`} label="SSN" hint="(9 digits)" mode="numeric" />
        <Txt p={`${pre}.age`} label="Age on Dec 31, 2026" mode="numeric" />
        <Txt p={`${pre}.occupation`} label="Occupation" />
        <Sel p={`${pre}.citizen`} label="U.S. citizen, national, or authorized to work when filing? (new for 2026)" opts={[["", "Select"], ["yes", "Yes"], ["no", "No"]]} />
      </Rows>
      <div className="lab-row"><Chk p={`${pre}.a65`} label="65 or older (born before Jan 2, 1962)" /><Chk p={`${pre}.blind`} label="Legally blind" /></div>
    </>
  );
}

const married = (R: TaxReturn) => R.fs === "mfj" || R.fs === "mfs";

const FORMS: Record<FormId, (R: TaxReturn) => ReactNode> = {
  fs: (R) => <>
    <Head fno="Form 1040 · Filing status" title="Filing status" help="Choose the status that fits the household on December 31, 2026. Head of household and qualifying surviving spouse need a qualifying person on the Dependents screen." />
    <Rows><Sel p="fs" label="Filing status" opts={FILING_STATUSES} /></Rows>
    {R.fs === "mfs" ? <Chk p="mfsLivedWith" label="Lived with spouse at any time in 2026" /> : null}
  </>,
  tp: () => <>
    <Head fno="Form 1040 · Taxpayer" title="Taxpayer information" help="Enter the name exactly as it appears on the Social Security card." />
    <Person pre="tp" />
    <Rows><Txt p="tp.phone" label="Phone" mode="tel" /><Txt p="tp.email" label="Email" mode="email" /></Rows>
  </>,
  sp: (R) => <>
    <Head fno="Form 1040 · Spouse" title="Spouse information" />
    {married(R) ? <Person pre="sp" /> : <div className="lab-notice">No spouse information is needed for {FS_NAME[R.fs]}.</div>}
  </>,
  addr: () => <>
    <Head fno="Form 1040 · Address" title="Address & contact" help="Use the address where the taxpayer receives mail." />
    <Rows><Txt p="addr.street" label="Street address" /><Txt p="addr.city" label="City" /><Txt p="addr.state" label="State" hint="(2 letters)" /><Txt p="addr.zip" label="ZIP code" mode="numeric" /></Rows>
  </>,
  deps: () => <>
    <Head fno="Form 1040 · Dependents" title="Dependents" help="Children under 17 with a valid SSN get the child tax credit; other dependents get the $500 credit for other dependents. The earned income credit uses its own qualifying child tests." />
    <Entries list="deps" title="Dependent" addLabel="Add dependent">{(p) => <>
      <Rows>
        <Txt p={`${p}name`} label="Full name" />
        <Txt p={`${p}ssnNum`} label="SSN" hint="(9 digits)" mode="numeric" />
        <Sel p={`${p}rel`} label="Relationship" opts={RELS.map((r) => [r, r])} />
        <Txt p={`${p}age`} label="Age on Dec 31, 2026" mode="numeric" />
        <Txt p={`${p}months`} label="Months lived in the home" hint="(0–12)" mode="numeric" />
      </Rows>
      <div className="lab-row"><Chk p={`${p}ssn`} label="Has a valid SSN for employment" /><Chk p={`${p}student`} label="Full-time student" /><Chk p={`${p}disabled`} label="Permanently and totally disabled" /></div>
    </>}</Entries>
    <Calcs rows={[["Children for the child tax credit", "kids"], ["Other dependents", "others"], ["Qualifying children for the earned income credit", "eicKids"]]} />
  </>,
  w2: () => <>
    <Head fno="Form W-2 · Wage and Tax Statement" title="Wages" help="Enter one W-2 per employer, exactly as printed." />
    <Entries list="w2" title="W-2" addLabel="Add W-2">{(p, i) => <>
      <Rows><Txt p={`${p}employer`} label="Box c · Employer name" /><Txt p={`${p}ein`} label="Box b · Employer EIN" hint="(XX-XXXXXXX)" /></Rows>
      <Who list="w2" i={i} />
      <Rows><Money p={`${p}wages`} label="Box 1 · Wages, tips, other comp." /><Money p={`${p}fedwh`} label="Box 2 · Federal income tax withheld" /></Rows>
    </>}</Entries>
    <Calcs rows={[["Line 1z · Total wages", "L1z"]]} />
  </>,
  int: () => <>
    <Head fno="Form 1099-INT · Interest Income" title="Interest" help="Box 1 is taxable. Box 8 tax-exempt interest counts toward the Social Security and earned income credit tests." />
    <Entries list="int" title="1099-INT" addLabel="Add 1099-INT">{(p) => <Rows>
      <Txt p={`${p}payer`} label="Payer's name" /><Money p={`${p}amt`} label="Box 1 · Interest income" /><Money p={`${p}fedwh`} label="Box 4 · Federal tax withheld" /><Money p={`${p}exempt`} label="Box 8 · Tax-exempt interest" />
    </Rows>}</Entries>
    <Calcs rows={[["Line 2b · Taxable interest", "L2b"]]} />
  </>,
  div: () => <>
    <Head fno="Form 1099-DIV · Dividends and Distributions" title="Dividends" help="Qualified dividends are taxed at capital gain rates. Box 2a flows to capital gains." />
    <Entries list="div" title="1099-DIV" addLabel="Add 1099-DIV">{(p) => <Rows>
      <Txt p={`${p}payer`} label="Payer's name" /><Money p={`${p}ord`} label="Box 1a · Total ordinary dividends" /><Money p={`${p}qual`} label="Box 1b · Qualified dividends" /><Money p={`${p}capd`} label="Box 2a · Total capital gain distr." /><Money p={`${p}fedwh`} label="Box 4 · Federal tax withheld" />
    </Rows>}</Entries>
    <Calcs rows={[["Line 3a · Qualified dividends", "qualDiv"], ["Line 3b · Ordinary dividends", "L3b"]]} />
  </>,
  g: () => <>
    <Head fno="Form 1099-G · Certain Government Payments" title="Unemployment" help="Box 1 unemployment is fully taxable. Enter a taxable state refund on Other income." />
    <Entries list="g" title="1099-G" addLabel="Add 1099-G">{(p) => <Rows>
      <Txt p={`${p}payer`} label="Payer's name (state agency)" /><Money p={`${p}unemp`} label="Box 1 · Unemployment compensation" /><Money p={`${p}fedwh`} label="Box 4 · Federal tax withheld" />
    </Rows>}</Entries>
    <Calcs rows={[["Schedule 1 line 7 · Unemployment", "unemp"]]} />
  </>,
  r: () => <>
    <Head fno="Form 1099-R · Retirement Distributions" title="Retirement distributions" help="Leave box 2a blank if it is blank on the form; box 1 is then treated as taxable. Code 1 adds the 10% additional tax." />
    <Entries list="r" title="1099-R" addLabel="Add 1099-R">{(p) => <>
      <Rows>
        <Txt p={`${p}payer`} label="Payer's name" /><Money p={`${p}gross`} label="Box 1 · Gross distribution" /><Money p={`${p}taxable`} label="Box 2a · Taxable amount" />
        <Money p={`${p}fedwh`} label="Box 4 · Federal tax withheld" /><Txt p={`${p}code`} label="Box 7 · Distribution code" hint="(e.g. 7, 1, G)" />
      </Rows>
      <Chk p={`${p}ira`} label="IRA/SEP/SIMPLE box is checked" />
    </>}</Entries>
    <Calcs rows={[["Line 4b · IRA distributions, taxable", "L4b"], ["Line 5b · Pensions and annuities, taxable", "L5b"], ["10% additional tax (Sched. 2)", "addl"]]} />
  </>,
  ssa: () => <>
    <Head fno="Form SSA-1099 · Social Security Benefit Statement" title="Social Security" help="Enter box 5 net benefits. The taxable part is figured with the Social Security Benefits Worksheet." />
    <Entries list="ssa" title="SSA-1099" addLabel="Add SSA-1099">{(p, i) => <>
      <Who list="ssa" i={i} />
      <Rows><Money p={`${p}net`} label="Box 5 · Net benefits" /><Money p={`${p}fedwh`} label="Box 6 · Voluntary federal tax withheld" /></Rows>
    </>}</Entries>
    <Calcs rows={[["Line 6a · Social Security benefits", "ssBen"], ["Line 6b · Taxable amount", "L6b"]]} />
  </>,
  schc: () => <>
    <Head fno="Schedule C · Profit or Loss From Business" title="Business income" help="One Schedule C per business. Include 1099-NEC and 1099-K income in gross receipts." />
    <Entries list="schc" title="Schedule C" addLabel="Add Schedule C">{(p, i) => <>
      <Rows><Txt p={`${p}name`} label="Business name" /></Rows>
      <Who list="schc" i={i} />
      <Rows>
        <Money p={`${p}receipts`} label="Line 1 · Gross receipts" hint="(all business income)" />
        <Txt p={`${p}necPayer`} label="1099-NEC payer" hint="(optional)" /><Money p={`${p}nec`} label="1099-NEC box 1 amount" hint="(optional)" />
      </Rows>
      <h3>Expenses</h3>
      <Rows>{EXPENSE_KEYS.map((k) => <Money key={k} p={`${p}${k}`} label={EXPENSE_LABELS[k]} />)}</Rows>
      <Calcs rows={[["Line 31 · Net profit or (loss)", `net-${i}`]]} />
    </>}</Entries>
    <Calcs rows={[["Schedule SE · Self-employment tax", "se"], ["Schedule 1 line 15 · Deductible part of SE tax", "halfSE"]]} />
  </>,
  capg: () => <>
    <Head fno="Form 8949 / Schedule D" title="Capital gains & losses" help="Enter totals from each 1099-B: net short-term and net long-term gain or loss (minus sign for losses)." />
    <Entries list="capg" title="1099-B" addLabel="Add 1099-B summary">{(p) => <Rows>
      <Txt p={`${p}desc`} label="Broker or description" /><Money p={`${p}st`} label="Net short-term gain or (loss)" /><Money p={`${p}lt`} label="Net long-term gain or (loss)" />
    </Rows>}</Entries>
    <Calcs rows={[["Capital gain distributions (1099-DIV)", "capDist"], ["Net capital gain or (loss)", "netCap"], ["Line 7a · Capital gain or (loss)", "L7a"]]} />
  </>,
  other: () => <>
    <Head fno="Schedule 1 · Part I" title="Other income" help="State refunds are taxable only if the taxpayer itemized in 2025 and got a tax benefit." />
    <Rows><Money p="other.staterefund" label="Line 1 · Taxable state or local refund" /><Txt p="other.desc" label="Line 8z · Other income description" /><Money p="other.amt" label="Line 8z · Amount" /></Rows>
    <Calcs rows={[["Line 8 · Additional income (Sched. 1 line 10)", "L8"], ["Line 9 · Total income", "L9"]]} />
  </>,
  adj: () => <>
    <Head fno="Schedule 1 · Part II" title="Adjustments to income" help="The deductible part of self-employment tax is figured for you." />
    <Rows>
      <Money p="adj.educator" label="Line 11 · Educator expenses" hint="($300 each)" /><Money p="adj.hsa" label="Line 13 · HSA deduction" /><Money p="adj.seHealth" label="Line 17 · Self-employed health insurance" />
      <Money p="adj.ira" label="Line 20 · IRA deduction" /><Money p="adj.sli" label="Line 21 · Student loan interest" hint="(1098-E)" /><Money p="adj.other" label="Other adjustments" />
    </Rows>
    <Calcs rows={[["Line 15 · Deductible part of SE tax", "halfSE"], ["Student loan interest allowed", "sli"], ["Line 10 · Total adjustments", "L10"], ["Line 11a · Adjusted gross income", "L11a"]]} />
  </>,
  item: (R) => <>
    <Head fno="Form 1040 lines 12e–12f · Schedule A" title="Standard or itemized" help="Itemize only when Schedule A is more than the standard deduction. For 2026 the SALT limit is $40,400 ($20,200 MFS), reduced for income over $505,000, and charitable gifts count only above 0.5% of AGI. Non-itemizers can deduct cash gifts to charity on line 12f." />
    <Rows><Sel p="ded.type" label="Deduction method" opts={[["std", "Standard deduction"], ["item", "Itemized deductions (Schedule A)"]]} /></Rows>
    {R.ded.type === "item" ? <>
      <Rows>
        <Money p="ded.med" label="Line 1 · Medical and dental expenses" /><Money p="ded.saltIncome" label="Line 5a · State income or sales tax" /><Money p="ded.saltRE" label="Line 5b · Real estate taxes" />
        <Money p="ded.saltPP" label="Line 5c · Personal property taxes" /><Money p="ded.mortInt" label="Line 8a · Home mortgage interest (1098)" /><Money p="ded.charCash" label="Gifts by cash or check" />
        <Money p="ded.charNon" label="Gifts other than cash" /><Money p="ded.otherItem" label="Other itemized deductions" />
      </Rows>
      <Calcs rows={[["Medical after 7.5% of AGI", "medAllowed"], ["State and local taxes allowed", "salt"], ["Charitable gifts after 0.5% of AGI", "charItem"], ["Schedule A total itemized", "itemized"]]} />
    </> : <Rows><Money p="ded.charStd" label="Line 12f · Cash gifts to qualified charities" hint="(up to $1,000; $2,000 MFJ)" /></Rows>}
    <Calcs rows={[["Standard deduction for this return", "std"], ["Line 12e · Deduction used", "L12e"], ["Line 12f · Charitable deduction for non-itemizers", "L12f"]]} />
  </>,
  s1a: () => <>
    <Head fno="Schedule 1-A · Additional Deductions" title="Seniors, tips, overtime, car loan" help="The $6,000 senior deduction is figured from the 65-or-older boxes. Enter qualified amounts; limits and phaseouts are applied for you." />
    <Rows><Money p="ded.tips" label="Qualified tips" hint="(max $25,000)" /><Money p="ded.overtime" label="Qualified overtime premium" hint="(max $12,500; $25,000 MFJ)" /><Money p="ded.carint" label="Qualified car loan interest" hint="(max $10,000)" /></Rows>
    <Calcs rows={[["Senior deduction", "senior"], ["Line 13a · Schedule 1-A total", "L13a"], ["Line 13b · QBI deduction", "L13b"], ["Line 15 · Taxable income", "L15"]]} />
  </>,
  ctc: () => <>
    <Head fno="Schedule 8812" title="Child tax credit" help="Figured from the Dependents screen: $2,200 per child under 17 with an SSN, $500 per other dependent, reduced for high income. The refundable part (ACTC) is up to $1,700 per child." />
    <Calcs rows={[["Children under 17", "kids"], ["Other dependents", "others"], ["Credit after income phaseout", "credit"], ["Line 19 · Nonrefundable credit used", "L19"], ["Line 28 · Additional child tax credit", "L28"]]} />
  </>,
  eic: () => <EicForm />,
  dc: () => <>
    <Head fno="Form 2441 · Child and Dependent Care" title="Child & dependent care" help="Expenses for qualifying persons under 13 (or disabled) so the taxpayer could work. Limit $3,000 for one person, $6,000 for two or more. New for 2026: the rate starts at 50% and phases down to 35%, then to 20% above $75,000 AGI ($150,000 MFJ)." />
    <Rows><Txt p="cred.dcPersons" label="Number of qualifying persons" mode="numeric" /><Money p="cred.dcExp" label="Qualified expenses paid in 2026" /></Rows>
    <Calcs rows={[["Credit", "dc"]]} />
  </>,
  ed: () => <>
    <Head fno="Form 8863 · Education Credits" title="Education credits" help="American opportunity: first 4 years of college, up to $2,500, 40% refundable. Lifetime learning: 20% of up to $10,000. Phaseout $80,000–$90,000 ($160,000–$180,000 MFJ)." />
    <Entries list="cred.ed" title="Student" addLabel="Add student">{(p) => <Rows>
      <Txt p={`${p}name`} label="Student name" /><Sel p={`${p}type`} label="Credit" opts={[["aotc", "American opportunity"], ["llc", "Lifetime learning"]]} /><Money p={`${p}exp`} label="Qualified expenses (1098-T)" />
    </Rows>}</Entries>
    <Calcs rows={[["American opportunity credit", "aotc"], ["Line 29 · Refundable part", "L29"], ["Lifetime learning credit", "llc"]]} />
  </>,
  ocred: () => <>
    <Head fno="Schedule 3" title="Other credits" help="Credits not figured on other screens, such as the retirement savings contributions credit." />
    <Rows><Money p="cred.nonref" label="Other nonrefundable credits" /><Money p="cred.ref" label="Other refundable credits" /></Rows>
    <Calcs rows={[["Line 20 · Schedule 3 nonrefundable total", "L20"], ["Line 31 · Schedule 3 refundable total", "L31"]]} />
  </>,
  aca: () => <>
    <Head fno="Form 8962 · Premium Tax Credit" title="Health insurance" help="If anyone had Marketplace coverage, complete Form 8962 from the 1095-A and enter the result here." />
    <Rows>
      <Sel p="health.covered" label="Did everyone on the return have health coverage all year?" opts={[["yes", "Yes"], ["no", "No"], ["part", "Some months only"]]} />
      <Money p="health.ptcNet" label="Net premium tax credit" hint="(Form 8962 line 26)" /><Money p="health.aptcRepay" label="Excess advance PTC repayment" hint="(Form 8962 line 29)" />
    </Rows>
    <Calcs rows={[["Line 17 · Excess advance PTC", "L17"]]} />
  </>,
  est: () => <>
    <Head fno="Form 1040 line 26" title="Estimated payments" help="Include every 2026 Form 1040-ES payment and any 2025 overpayment applied to 2026." />
    <Rows><Money p="pay.est" label="2026 estimated tax payments" /><Money p="pay.prior" label="2025 overpayment applied to 2026" /></Rows>
    <Calcs rows={[["Line 26 · Total", "L26"]]} />
  </>,
  applyn: () => <>
    <Head fno="Form 1040 line 36" title="Apply refund to 2027" help="Part of the overpayment can go toward 2027 estimated tax instead of being refunded." />
    <Rows><Money p="pay.applyNext" label="Amount to apply to 2027 estimated tax" /></Rows>
    <Calcs rows={[["Line 34 · Overpayment", "L34"], ["Line 36 · Applied to 2027", "L36"], ["Line 35a · Refund", "L35a"]]} />
  </>,
};

function EicForm() {
  const { c } = useSW();
  return <>
    <Head fno="Schedule EIC · Earned Income Credit" title="Earned income credit" help="Figured from earned income, AGI and qualifying children (under 19, under 24 if a student, or disabled, and in the home more than half the year)." />
    <Calcs rows={[["Qualifying children", "eicKids"], ["Earned income", "earned"], ["Investment income", "invInc"], ["Line 27a · Earned income credit", "L27a"]]} />
    {c.d.eicWhy ? <p className="lab-muted lab-small">{c.d.eicWhy}</p> : null}
  </>;
}

function formStatus(id: FormId, R: TaxReturn, c: Computed): string {
  const cnt = (a: unknown[], w: string) => (a.length ? `${a.length} ${w}${a.length > 1 ? "s" : ""}` : "—");
  const name = `${R.tp.first} ${R.tp.last}`.trim();
  switch (id) {
    case "fs": return FS_NAME[R.fs];
    case "tp": return name || "Not started";
    case "sp": return married(R) ? (`${R.sp.first} ${R.sp.last}`.trim() || "Not started") : "Not needed";
    case "addr": return R.addr.city ? `${R.addr.city}${R.addr.state ? `, ${R.addr.state}` : ""}` : "Not started";
    case "deps": return cnt(R.deps, "dependent");
    case "w2": return R.w2.length ? `${cnt(R.w2, "W-2")} · ${fmt(c.lines.L1z)}` : "—";
    case "int": case "div": case "g": case "r": return cnt((R as unknown as Record<string, unknown[]>)[id], "form");
    case "ssa": return cnt(R.ssa, "statement");
    case "schc": return R.schc.length ? `${cnt(R.schc, "business")} · ${fmt(c.d.schcNet)}` : "—";
    case "capg": return cnt(R.capg, "entry");
    case "other": { const v = c.lines.L8 - c.d.schcNet - c.d.unemp; return v ? fmt(v) : "—"; }
    case "adj": return c.lines.L10 ? fmt(c.lines.L10) : "—";
    case "item": return `${R.ded.type === "item" ? "Itemized" : "Standard"} · ${fmt(c.lines.L12e)}`;
    case "s1a": return c.lines.L13a ? fmt(c.lines.L13a) : "—";
    case "ctc": return c.lines.L19 + c.lines.L28 ? fmt(c.lines.L19 + c.lines.L28) : "—";
    case "eic": return c.lines.L27a ? fmt(c.lines.L27a) : "—";
    case "dc": return c.d.dc ? fmt(c.d.dc) : "—";
    case "ed": return cnt(R.cred.ed, "student");
    case "ocred": return n(R.cred.nonref) || n(R.cred.ref) ? "Entered" : "—";
    case "aca": return ({ yes: "Covered all year", no: "Not covered", part: "Part year" } as Record<string, string>)[R.health.covered] ?? "—";
    case "est": return c.lines.L26 ? fmt(c.lines.L26) : "—";
    case "applyn": return c.lines.L36 ? fmt(c.lines.L36) : "—";
  }
  return "";
}
const hasData = (st: string) => Boolean(st) && !["—", "Not started", "Not needed"].includes(st) && !st.startsWith("Standard");

function maskSSN(v: string) {
  const d = String(v || "").replace(/\D/g, "");
  return d.length === 9 ? `XXX-XX-${d.slice(5)}` : "SSN not entered";
}

export type SoftwareProps = {
  ret: TaxReturn;
  onChange: (ret: TaxReturn) => void;
  mode: "student" | "key";
  /** Opens the return summary PDF (Summary / Print). */
  printHref?: string;
};

export function Software({ ret, onChange, mode, printHref }: SoftwareProps) {
  const [sec, setSec] = useState("basic");
  const [form, setForm] = useState<FormId | null>(null);
  const [ent, setEntState] = useState<Record<string, number>>({});
  const [diag, setDiag] = useState<Diagnostic[] | null>(null);
  const c = useMemo(() => compute(ret), [ret]);
  const rejects = useMemo(() => diagnostics(ret).filter((d) => d.level === "reject").length, [ret]);
  const ctx: Ctx = {
    ret, c,
    set: (path, v) => onChange(setIn(ret, path.split("."), v)),
    ent, setEnt: (list, i) => setEntState((e) => ({ ...e, [list]: i })),
  };
  const go = (s: string, f: FormId | null) => { setSec(s); setForm(f); if (s === "efile") setDiag(diagnostics(ret)); };
  const section = SECTIONS.find((s) => s.id === sec)!;
  const owe = c.lines.L37 > 0;
  const name = `${ret.tp.first} ${ret.tp.last}`.trim();

  let body: ReactNode;
  if (sec === "sum") {
    body = <>
      <Head fno="Form 1040 · U.S. Individual Income Tax Return 2026" title="Return summary" help="Review every line before you move to E-File." />
      <div className="lab-scroll"><table className="lab-table f1040"><tbody>
        {LINES.map(([k, ln, label]) => <tr key={k} className={["L9", "L11a", "L15", "L24", "L33", "L35a", "L37"].includes(k) ? "tot" : undefined}><td className="ln">{ln}</td><td>{label}</td><td className="v">{fmt(c.lines[k])}</td></tr>)}
      </tbody></table></div>
      {c.notes.map((x) => <div key={x} className="lab-notice warn">{x}</div>)}
      {printHref ? <div className="lab-row"><a className="lab-btn" href={printHref} target="_blank" rel="noopener">Download return summary (PDF)</a></div> : null}
    </>;
  } else if (sec === "efile") {
    const rej = diag?.filter((d) => d.level === "reject").length ?? 0;
    body = <>
      <Head fno="Form 8879 · E-file" title="E-File" help="Choose how the refund is paid, enter signature PINs, then run the e-file check. Fix every reject before you transmit." />
      <Rows>
        <Sel p="efile.method" label="Refund method" opts={[["dd", "Direct deposit"], ["check", "Paper check"]]} />
        {ret.efile.method === "dd" ? <><Txt p="efile.routing" label="Routing number" hint="(9 digits)" mode="numeric" /><Txt p="efile.account" label="Account number" mode="numeric" /><Sel p="efile.acctType" label="Account type" opts={[["checking", "Checking"], ["savings", "Savings"]]} /></> : null}
        <Txt p="efile.pin" label="Taxpayer self-select PIN" hint="(5 digits)" mode="numeric" />
        {ret.fs === "mfj" ? <Txt p="efile.spPin" label="Spouse self-select PIN" hint="(5 digits)" mode="numeric" /> : null}
      </Rows>
      <Chk p="efile.consent" label="Taxpayer reviewed the return and signed Form 8879" />
      <div className="lab-row"><button type="button" className="lab-btn primary" onClick={() => setDiag(diagnostics(ret))}>Run e-file check</button></div>
      {diag ? <>
        <div className={`lab-notice ${rej ? "bad" : "good"}`}><b>{rej ? `${rej} reject${rej > 1 ? "s" : ""} must be fixed.` : "Ready to transmit."}</b> {diag.length - rej} warning{diag.length - rej === 1 ? "" : "s"}.</div>
        <div>{diag.map((d, i) => { const g = DIAG_GO[d.where]; return (
          <div className="diag" key={i}>
            <span className={`lab-pill ${d.level === "reject" ? "bad" : "warn"}`}>{d.level === "reject" ? "Reject" : "Warning"}</span>
            <span><b>{d.where}</b><br />{d.msg}</span>
            {g ? <button type="button" className="lab-btn sm" onClick={() => go(g[0], g[1])}>Fix</button> : <span />}
          </div>
        ); })}</div>
      </> : null}
    </>;
  } else if (!form) {
    const idx = SECTIONS.findIndex((s) => s.id === sec);
    const next = SECTIONS[idx + 1];
    body = <>
      <Head fno="Main menu" title={section.label} help="Select a form to begin or edit it." />
      <div className="menu">{section.forms!.map(([id, label]) => (
        <div className="menuitem" key={id}><b>{label}</b><span className="st">{formStatus(id, ret, c)}</span><button type="button" className="lab-btn sm" onClick={() => setForm(id)}>Begin / Edit</button></div>
      ))}</div>
      {next ? <div className="lab-row" style={{ justifyContent: "flex-end" }}><button type="button" className="lab-btn primary" onClick={() => go(next.id, null)}>Continue to {next.label}</button></div> : null}
    </>;
  } else {
    const forms = section.forms!;
    const i = forms.findIndex(([id]) => id === form);
    const next = forms[i + 1];
    body = <>
      <div className="crumb"><button type="button" onClick={() => setForm(null)}>{section.label}</button><span>›</span><span>{forms[i][1]}</span></div>
      {FORMS[form](ret)}
      <div className="lab-row lab-between">
        <button type="button" className="lab-btn" onClick={() => setForm(null)}>Back to {section.label} menu</button>
        {next ? <button type="button" className="lab-btn primary" onClick={() => setForm(next[0])}>Continue to {next[1]}</button> : null}
      </div>
    </>;
  }

  return (
    <SW.Provider value={ctx}>
      <div className="pro">
        <div className="pbar">
          <div className="pbrand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/mark.png" alt="" />
            <div><b>Monarch Tax Suite</b><span>Professional · 2026 Individual 1040</span></div>
          </div>
          <div className="pclient"><b>{name || "New return"}</b><span>{maskSSN(ret.tp.ssn)} · {FS_NAME[ret.fs]}{mode === "key" ? " · ANSWER KEY" : ""}</span></div>
        </div>
        <div className="ptools">
          <button type="button" className="tool" onClick={() => go(SECTIONS.find((s) => s.id === sec)?.forms ? sec : "basic", null)}>Main menu</button>
          <button type="button" className="tool" onClick={() => go("sum", null)}>Summary</button>
          <button type="button" className="tool" onClick={() => go("efile", null)}>E-file check{rejects ? <span className="badge">{rejects}</span> : null}</button>
          {printHref ? <a className="tool" href={printHref} target="_blank" rel="noopener">Print</a> : null}
          <label className="pjump">Go to
            <select aria-label="Go to form" value={`${sec}|${form ?? ""}`} onChange={(e) => { const [s, f] = e.target.value.split("|"); go(s, f || null); }}>
              {SECTIONS.map((s) => (
                <optgroup key={s.id} label={s.label}>
                  <option value={`${s.id}|`}>{s.label}{s.forms ? " menu" : ""}</option>
                  {(s.forms ?? []).map(([id, label]) => <option key={id} value={`${s.id}|${id}`}>{label}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
        </div>
        <div className="pbody">
          <nav className="ptree" aria-label="Return forms">
            {SECTIONS.map((s) => (
              <div key={s.id}>
                <button type="button" className="tsec" aria-current={sec === s.id && !form ? "true" : undefined} onClick={() => go(s.id, null)}>{s.label}</button>
                {(s.forms ?? []).map(([id, label]) => (
                  <button type="button" key={id} className="titem" aria-current={sec === s.id && form === id ? "true" : undefined} onClick={() => go(s.id, id)}>
                    <span className={`dot${hasData(formStatus(id, ret, c)) ? " on" : ""}`} />{label}
                  </button>
                ))}
              </div>
            ))}
          </nav>
          <section className="ppane">{body}</section>
        </div>
        <div className={`pstatus ${owe ? "owe" : "refund"}`}>
          <div className="ps big"><span>Federal</span><b className="fed">{owe ? "Balance due" : "Refund"}</b><b className="fed">{fmt(owe ? c.lines.L37 : c.lines.L35a)}</b></div>
          <div className="ps"><span>AGI</span><b>{fmt(c.lines.L11a)}</b></div>
          <div className="ps hs"><span>Taxable income</span><b>{fmt(c.lines.L15)}</b></div>
          <div className="ps hs"><span>Total tax</span><b>{fmt(c.lines.L24)}</b></div>
          <div className="ps hs"><span>Payments</span><b>{fmt(c.lines.L33)}</b></div>
        </div>
      </div>
    </SW.Provider>
  );
}
