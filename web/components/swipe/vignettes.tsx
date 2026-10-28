import type { CSSProperties, ReactNode } from "react";
import { CheckIcon, CompassIcon } from "lucide-react";

/*
 * Small built UI fragments, one per topic (not per card), ported from swipe.html.
 * Each has one bloom, one bleed or depth, one interaction moment. Figures are round and illustrative.
 */

export type Visual =
  | { type: "table"; caption: string; cols: [string, string]; rows: [string, string, string][] }
  | { type: "slider"; context: string; label: string; value: string; pct: number; outLabel: string; out: string; note: ReactNode }
  | { type: "options"; rows: { name: string; desc: string; rate: string; access: number }[] }
  | { type: "statement"; title: string; meta: string; lines: { name: string; desc: string; amt: string; sel?: boolean }[] }
  | { type: "checklist"; title: string; status?: string; doneLabel?: string; todoLabel?: string; items: { name: string; desc: string; done: boolean }[] }
  | { type: "growth"; label: string; value: string; bars: number[]; from: string; to: string }
  | { type: "split"; label: string; value: string; parts: { name: string; pct: number; amt: string }[] }
  | { type: "message"; from: string; time: string; text: ReactNode; note: string }
  | { type: "note"; top: string; value: string; big: string; foot: ReactNode }
  | { type: "dyk" };

export type Topic = { short: string; bloom: [string, string]; visual: Visual };

const Cursor = ({ x, y }: { x: string; y: string }) => (
  <svg className="cursor" style={{ left: x, top: y }} viewBox="0 0 16 16"><path d="M2 1l11 6.5-4.6 1.1L6.3 13z" fill="#111" stroke="#fff" strokeWidth="1" /></svg>
);
const Raiffy = () => <span className="ava ava-raiffy"><CompassIcon strokeWidth={1.6} /></span>;
const vars = (v: Record<string, string>) => v as CSSProperties;

export function Vignette({ v }: { v: Visual }) {
  switch (v.type) {
    case "table": return (
      <>
        <div className="frag v-table fade-r">
          <div className="v-cap"><Raiffy /><b>{v.caption}</b></div>
          <div className="mtable">
            <div className="th" />{v.cols.map((c) => <div key={c} className="th">{c}</div>)}
            {v.rows.map((r) => [<div key={`${r[0]}k`} className="rk">{r[0]}</div>, <div key={`${r[0]}a`}>{r[1]}</div>, <div key={`${r[0]}b`}>{r[2]}</div>])}
          </div>
        </div>
        <Cursor x="62%" y="62%" />
      </>
    );
    case "slider": return (
      <div className="frag v-slider">
        <div className="v-row"><span>{v.context}</span></div>
        <div className="v-row"><span>{v.label}</span><b>{v.value}</b></div>
        <div className="track" style={vars({ "--p": `${v.pct}%` })}><span /><i /></div>
        <div className="v-out"><div><span className="micro">{v.outLabel}</span><br /><b>{v.out}</b></div><span className="micro">{v.note}</span></div>
      </div>
    );
    case "options": return (
      <>
        <div className="v-opts fade-r">
          {v.rows.map((r, i) => (
            <div key={r.name} className={i === v.rows.length - 1 ? "frag v-opt dim" : "frag v-opt"} style={{ position: "relative" }}>
              <div><div className="nm">{r.name}</div><div className="ds">{r.desc}</div></div>
              <div className="rt">{r.rate}<div className="liq">{[0, 1, 2, 3].map((n) => <i key={n} className={n < r.access ? "f" : undefined} />)}</div></div>
            </div>
          ))}
        </div>
        <Cursor x="70%" y="30%" />
      </>
    );
    case "statement": return (
      <>
        <div className="frag v-stmt fade-b">
          <div className="v-stmt-h"><b>{v.title}</b><span>{v.meta}</span></div>
          {v.lines.map((l) => (
            <div key={l.name} className={l.sel ? "line sel" : "line"}><span>{l.name}<small>{l.desc}</small></span><span className="amt">{l.amt}</span></div>
          ))}
        </div>
        <Cursor x="58%" y="40%" />
      </>
    );
    case "checklist": {
      const done = v.items.filter((i) => i.done).length;
      return (
        <div className="frag v-check fade-b">
          <div className="v-check-h"><b>{v.title}</b><span className="micro">{v.status || `${done} of ${v.items.length} ready`}</span></div>
          <div className="prog" style={vars({ "--p": `${Math.round((done / v.items.length) * 100)}%` })}><span /></div>
          {v.items.map((i) => (
            <div key={i.name} className="ck">
              <span className={i.done ? "bx ok" : "bx"}>{i.done && <CheckIcon strokeWidth={1.6} />}</span>
              <span>{i.name}<small>{i.desc}</small></span>
              <span className="micro">{i.done ? v.doneLabel || "Done" : v.todoLabel || "To do"}</span>
            </div>
          ))}
        </div>
      );
    }
    case "growth": return (
      <>
        <div className="frag v-growth">
          <div className="v-row"><span>{v.label}</span><b>{v.value}</b></div>
          <div className="gbars">{v.bars.map((h, i) => <i key={i} style={vars({ "--h": `${h}%` })} className={i === v.bars.length - 1 ? "on" : undefined} />)}</div>
          <div className="v-row"><span className="micro">{v.from}</span><span className="micro">{v.to}</span></div>
        </div>
        <Cursor x="88%" y="38%" />
      </>
    );
    case "split": return (
      <div className="frag v-split">
        <div className="v-row"><span>{v.label}</span><b>{v.value}</b></div>
        <div className="seg">{v.parts.map((p, i) => <i key={p.name} className={`s${i + 1}`} style={{ flex: p.pct }} />)}</div>
        <div className="legend">
          {v.parts.map((p, i) => (
            <div key={p.name}><i style={{ background: ["var(--ink)", "#BDB8AE", "var(--accent-a)"][i] }} /><span>{p.name} · {p.pct}%</span><b>{p.amt}</b></div>
          ))}
        </div>
      </div>
    );
    case "message": return (
      <div className="frag v-msg">
        <div className="v-msg-h"><b>{v.from}</b><span>{v.time}</span></div>
        <p>{v.text}</p>
        <div className="note"><Raiffy />{v.note}</div>
      </div>
    );
    case "note": return (
      <>
        <div className="frag v-note dim" />
        <div className="frag v-note">
          <div className="nt-top"><span>{v.top}</span><span>{v.value}</span></div>
          <div className="nt-win" />
          <div className="nt-big">{v.big}</div>
          <div className="nt-foot">{v.foot}</div>
        </div>
      </>
    );
    case "dyk": return <div className="frag v-msg"><div className="note"><Raiffy />Did you know…</div></div>;
  }
}

// One visual per topic, in the order the topics appear in the markdown. Extra topics fall back to `dyk`.
const growth = Array.from({ length: 13 }, (_, n) => Math.round((1.06 ** n / 1.06 ** 12) * 100));
export const TOPICS: Topic[] = [
  { short: "Basics", bloom: ["90%", "0%"], visual: { type: "growth", label: "1,000 lei at 6% a year", value: "2,012 lei", bars: growth, from: "Today", to: "Year 12: doubled" } },
  { short: "Budgeting", bloom: ["10%", "100%"], visual: { type: "split", label: "Net income", value: "6,000 lei", parts: [
    { name: "Needs", pct: 50, amt: "3,000 lei" }, { name: "Wants", pct: 30, amt: "1,800 lei" }, { name: "Savings", pct: 20, amt: "1,200 lei" }] } },
  { short: "Saving", bloom: ["92%", "95%"], visual: { type: "slider", context: "Emergency fund · goal 6 months", label: "Saved so far", value: "9,600 lei", pct: 50,
    outLabel: "Covers", out: "3 months", note: <>Essentials<br />3,200 lei / month</> } },
  { short: "Credit", bloom: ["88%", "8%"], visual: { type: "table", caption: "Same rate, different DAE", cols: ["Loan A", "Loan B"],
    rows: [["Interest", "9.5%", "9.5%"], ["Fees", "0 lei", "400 lei"], ["DAE", "9.9%", "14.8%"]] } },
  { short: "Homes", bloom: ["90%", "6%"], visual: { type: "statement", title: "Buying a 400,000 lei flat", meta: "Beyond the price", lines: [
    { name: "Notary fees", desc: "Sale contract", amt: "≈ 3,900", sel: true },
    { name: "Land register", desc: "Extract and registration", amt: "≈ 650" },
    { name: "Valuation", desc: "Required by the lender", amt: "≈ 600" },
    { name: "Home insurance (PAD)", desc: "Mandatory · yearly", amt: "≈ 100" }] } },
  { short: "Cards & payments", bloom: ["10%", "0%"], visual: { type: "table", caption: "Paying 50 EUR in Vienna", cols: ["In euro", "In lei"],
    rows: [["Converted by", "Card network", "Merchant"], ["Rate", "≈ 5.03", "≈ 5.18"], ["You pay", "≈ 251 lei", "≈ 259 lei"]] } },
  { short: "Fraud", bloom: ["92%", "100%"], visual: { type: "message", from: "+40 7•• ••• 214", time: "SMS · now",
    text: <><mark>URGENT:</mark> your account will be suspended today. Confirm your details at <mark>secure-banking-ro.info/verify</mark></>,
    note: "Two warning signs: pressure and an unknown link." } },
  { short: "Investing", bloom: ["90%", "10%"], visual: { type: "options", rows: [
    { name: "Government bonds · 1 year", desc: "Rate fixed at issue", rate: "6.2%", access: 2 },
    { name: "Index fund", desc: "Risk score 4 of 7", rate: "Varies", access: 3 },
    { name: "Single company shares", desc: "Risk score 6 of 7", rate: "Varies", access: 3 }] } },
  { short: "Pensions & insurance", bloom: ["8%", "100%"], visual: { type: "checklist", title: "Your pension pillars", status: "3 pillars",
    doneLabel: "Active", todoLabel: "Optional", items: [
      { name: "Pillar I · State pension", desc: "Paid through your salary", done: true },
      { name: "Pillar II · Private pension", desc: "An account in your name", done: true },
      { name: "Pillar III · Voluntary", desc: "Tax advantages up to a limit", done: false }] } },
  { short: "Money history", bloom: ["85%", "0%"], visual: { type: "note", top: "ROMÂNIA", value: "1 LEU", big: "1",
    foot: <>Polymer since 1999<br />10,000 old lei = 1 leu</> } },
];
