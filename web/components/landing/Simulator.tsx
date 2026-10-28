"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { CompassIcon, SparklesIcon } from "lucide-react";
import { compareAmortised, recommend, remainingBalance, type Comparison, type Recommendation } from "@/lib/finance";
import { EARLY_REPAYMENT_FEE_RATE, LANDING_LOAN, LANDING_OVERDRAFT } from "@/lib/demo-terms";
import { fmt, lei, months } from "@/lib/format";

type Mode = "compare" | "early";

const AMOUNT = { min: 1000, max: 40000, step: 500 };
const TERM = { min: 3, max: 60, step: 1 };
const fill = (v: number, r: { min: number; max: number }) => ({ "--p": `${((v - r.min) / (r.max - r.min)) * 100}%` }) as CSSProperties;

function compareCopy(A: number, n: number, c: Comparison, rec: Recommendation) {
  const t = months(n), d = rec.difference;
  if (rec.rule === "only-fit")
    return `I recommend the personal loan. ${lei(A)} is over the usual overdraft limit, so it’s the only fit, and over ${t} you’d pay ${lei(c.loan.monthly)} a month at a rate that never changes.`;
  if (rec.rule === "near-tie")
    return `I recommend the personal loan. Over ${t} both cost almost the same, and its fixed rate means your payment can’t go up. The overdraft is the pick if you’d rather repay whenever you like.`;
  if (rec.pick === "overdraft")
    return `I recommend the overdraft. Over ${t} it costs about ${lei(d)} less, because the loan has a one-off fee, and you can repay it anytime for free. The loan is the pick if you want a fixed rate and a clear end date.`;
  return `I recommend the personal loan. Over ${t} it costs about ${lei(d)} less, thanks to its lower fixed rate.` +
    (n > 12 ? " The overdraft renews every year, so its rate can change along the way." : " The overdraft is the pick if you want to repay early with no fee.");
}

function earlyCopy(A: number, n: number, odOk: boolean) {
  const k = Math.max(1, Math.floor(n / 2));
  const left = remainingBalance(A, LANDING_LOAN.annualRate, n, k);
  return `Say you pay it all off after ${months(k)}. The loan charges 0.5% of the remaining balance, about ${lei(left * EARLY_REPAYMENT_FEE_RATE)}. ` +
    (odOk ? "The overdraft costs nothing extra. " : "") + "Either way, interest stops the day you repay. Do you expect to repay early?";
}

/** Loan or overdraft? The live comparison card. Values update instantly while dragging: no animation on a high-frequency input. */
export function Simulator() {
  const [amount, setAmount] = useState(8000);
  const [term, setTerm] = useState(12);
  const [mode, setMode] = useState<Mode>("compare");
  // The answer only crossfades when the customer asks a new question; while sliding it updates instantly
  const [shown, setShown] = useState<Mode>("compare");
  const [swapping, setSwapping] = useState(false);
  const swapTimer = useRef(0);
  useEffect(() => () => clearTimeout(swapTimer.current), []);

  const c = compareAmortised({ amount, months: term }, LANDING_LOAN, LANDING_OVERDRAFT);
  const rec = recommend(c);
  const odOk = c.overdraft.available;
  const max = Math.max(c.loan.cost, odOk ? c.overdraft.cost : 0);
  const text = shown === "early" ? earlyCopy(amount, term, odOk) : compareCopy(amount, term, c, rec);
  const odNote = !odOk ? "Over the 15,000 lei overdraft limit." : term > 12 ? "Renews every 12 months; the rate can change." : "Repay any amount, anytime.";

  function onSlide(set: (v: number) => void, v: number) {
    set(v);
    clearTimeout(swapTimer.current);
    setSwapping(false);
    setMode("compare");
    setShown("compare");
  }
  function onAsk() {
    const next: Mode = mode === "early" ? "compare" : "early";
    setMode(next);
    clearTimeout(swapTimer.current);
    setSwapping(true);
    swapTimer.current = window.setTimeout(() => { setShown(next); setSwapping(false); }, 120);
  }

  const badge = (on: boolean) => (
    <span className="rec-badge" hidden={!on}><SparklesIcon strokeWidth={1.6} />Recommended</span>
  );

  return (
    <div className="card simulator reveal" style={{ "--d": "1" } as CSSProperties} aria-labelledby="sim-title">
      <div className="bloom" aria-hidden="true" />
      <div className="sim-head">
        <h3 id="sim-title">Loan or overdraft? Try it.</h3>
        <span className="pill" style={{ "--c": "#8A6A00", background: "#FFF3C4" } as CSSProperties}>Illustrative rates</span>
      </div>

      <div className="ctrl">
        <div className="ctrl-top"><label htmlFor="amt">How much do you need?</label><output id="amt-out" htmlFor="amt">{lei(amount)}</output></div>
        <input className="range" id="amt" type="range" {...AMOUNT} value={amount} aria-describedby="amt-scale"
          style={fill(amount, AMOUNT)} onChange={(e) => onSlide(setAmount, +e.target.value)} />
        <div className="scale" id="amt-scale"><span>1,000 lei</span><span>40,000 lei</span></div>
      </div>
      <div className="ctrl">
        <div className="ctrl-top"><label htmlFor="term">Over how long?</label><output id="term-out" htmlFor="term">{months(term)}</output></div>
        <input className="range" id="term" type="range" {...TERM} value={term} aria-describedby="term-scale"
          style={fill(term, TERM)} onChange={(e) => onSlide(setTerm, +e.target.value)} />
        <div className="scale" id="term-scale"><span>3 months</span><span>60 months</span></div>
      </div>

      <div className="opts">
        <div className={rec.pick === "loan" ? "opt rec" : "opt"} id="opt-loan">
          <div className="opt-h">{badge(rec.pick === "loan")}Personal loan <span className="micro">7.9% fixed · 249 lei fee</span></div>
          <div className="big" id="loan-m">{fmt(c.loan.monthly)}<small>lei / month</small></div>
          <div className="kv">
            <div>Total cost <b id="loan-c">{lei(c.loan.cost)}</b></div>
            <div>Total to repay <b id="loan-t">{lei(c.loan.total)}</b></div>
          </div>
          <div className="costbar"><span id="loan-bar" style={{ transform: `scaleX(${c.loan.cost / max})` }} /></div>
          <div className="opt-note">The same payment every month, until the end.</div>
        </div>
        <div className={["opt", !odOk && "na", rec.pick === "overdraft" && "rec"].filter(Boolean).join(" ")} id="opt-od">
          <div className="opt-h">{badge(rec.pick === "overdraft")}Overdraft <span className="micro">11.5% variable · no fee</span></div>
          <div className="big" id="od-m">{odOk ? fmt(c.overdraft.monthly) : "—"}<small>lei / month</small></div>
          <div className="kv">
            <div>Total cost <b id="od-c">{odOk ? lei(c.overdraft.cost) : "—"}</b></div>
            <div>Total to repay <b id="od-t">{odOk ? lei(c.overdraft.total) : "—"}</b></div>
          </div>
          <div className="costbar"><span id="od-bar" style={{ transform: `scaleX(${odOk ? c.overdraft.cost / max : 0})` }} /></div>
          <div className="opt-note" id="od-note">{odNote}</div>
        </div>
      </div>

      <div className="explain">
        <span className="ava ava-raiffy" aria-hidden="true"><CompassIcon strokeWidth={1.6} /></span>
        <div>
          <p id="explain" aria-live="polite" className={swapping ? "swapping" : undefined}>{text}</p>
          <div className="q">
            <button className="qbtn" type="button" id="q-early" onClick={onAsk}>
              {mode === "early" ? "Back to the comparison" : "What if I repay early?"}
            </button>
            <a className="qbtn" href="#handoff">Book an advisor</a>
          </div>
        </div>
      </div>
      <p className="sim-foot">Concept demo. The overdraft is modelled as repaid in equal monthly instalments, up to an illustrative limit of 15,000 lei. Not an offer.</p>
    </div>
  );
}
