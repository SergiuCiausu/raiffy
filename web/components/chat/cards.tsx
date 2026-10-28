"use client";

import { useId, type CSSProperties } from "react";
import {
  CalculatorIcon, CalendarCheckIcon, CalendarIcon, CheckIcon, CircleHelpIcon, CompassIcon, HeadsetIcon, LandmarkIcon,
  ListChecksIcon, LockIcon, MapPinIcon, PiggyBankIcon, ReceiptIcon, ScaleIcon, SparklesIcon, UploadIcon, WalletIcon,
  type LucideIcon,
} from "lucide-react";
import { fmt, lei, percent } from "@/lib/format";
import { recCopy, simCalc, type Card } from "./data";

/* Generative-UI cards attached to Raiffy's answers, ported from chat.html's cardHTML(). */

type CardOf<T extends Card["type"]> = Extract<Card, { type: T }>;
type Props = { card: Card; enter: boolean; onChange: (card: Card) => void; onAsk: (text: string) => void; announce: (msg: string) => void };

const RecBadge = ({ hidden }: { hidden?: boolean }) => (
  <span className="rec-badge" hidden={hidden}><SparklesIcon />Recommended</span>
);
const Head = ({ icon: Icon, title, meta, metaClass = "micro" }: { icon: LucideIcon; title: string; meta: string; metaClass?: string }) => (
  <div className="gc-h"><span><Icon />{title}</span><span className={metaClass}>{meta}</span></div>
);
const strong = { color: "var(--text-1)", fontWeight: 500 } as CSSProperties;

export function AnswerCard(props: Props) {
  const cls = (base: string) => (props.enter ? `${base} enter` : base);
  switch (props.card.type) {
    case "compare": return <CompareCard card={props.card} cls={cls} />;
    case "sim": return <SimCard {...props} card={props.card} cls={cls} />;
    case "savings": return <SavingsCard cls={cls} />;
    case "fee": return <FeeCard cls={cls} />;
    case "docs": return <DocsCard {...props} card={props.card} cls={cls} />;
    case "handoff": return <HandoffCard onAsk={props.onAsk} cls={cls} />;
  }
}

function CompareCard({ card: c, cls }: { card: CardOf<"compare">; cls: (b: string) => string }) {
  const s = simCalc(c.amount, c.term, c.rate), rec = recCopy(s, c.amount, c.term);
  const L = rec.k === "loan" ? "rc" : "", O = rec.k === "od" ? "rc" : "";
  const on = (x: string) => (x ? `on ${x}` : "on");
  return (
    <div className={cls("gcard")}>
      <Head icon={ScaleIcon} title="Loan vs overdraft" meta={`${lei(c.amount)} · ${c.term} mo`} />
      <div className="tbl-wrap">
        <div className="cmp" role="table" aria-label="Personal loan compared with overdraft">
          <div className="th" role="columnheader" />
          <div className={`th ${L}`.trim()} role="columnheader">Personal loan<small>{percent(c.rate)} fixed</small>{L && <RecBadge />}</div>
          <div className={`th ${O}`.trim()} role="columnheader">Overdraft<small>11.5% variable</small>{O && <RecBadge />}</div>
          <div className="rk">Monthly payment</div><div className={L}>{lei(s.loan.monthly)}</div><div className={O}>{lei(s.overdraft.monthly)}</div>
          <div className="rk on">Total cost</div><div className={on(L)}>{lei(s.loan.cost)}</div><div className={on(O)}>{lei(s.overdraft.cost)}</div>
          <div className="rk">Your rate</div><div className={L}>Never changes</div><div className={O}>Can change monthly</div>
          <div className="rk">Early repayment</div><div className={L}>0.5% fee</div><div className={O}>Anytime, free</div>
          <div className="rk">Flexibility</div><div className={L}>Fixed schedule</div><div className={O}>Use and top up</div>
        </div>
      </div>
      <div className="rec-why">
        <div className="rec-why-h"><span className="ava-raiffy" aria-hidden="true"><CompassIcon /></span>Why I recommend {rec.name}</div>
        <ul>{rec.reasons.map((t) => <li key={t}><CheckIcon /><span>{t}</span></li>)}</ul>
        <p className="rec-alt">{rec.alt} Both options stay open, and the choice is yours.</p>
      </div>
    </div>
  );
}

const TERMS = [6, 12, 24, 36, 60];
const AMT = { min: 1000, max: 30000, step: 500 };

function SimCard({ card: c, cls, onChange }: Props & { card: CardOf<"sim">; cls: (b: string) => string }) {
  const id = useId(), tl = useId();
  const P = c.amount, n = c.term;
  const s = simCalc(P, n, c.rate), rec = recCopy(s, P, n), ok = s.overdraft.available;
  const max = Math.max(s.loan.cost, ok ? s.overdraft.cost : 0);
  const optClass = (k: "loan" | "od") => ["opt", k === "od" && !ok && "na", rec.k === k && "rec"].filter(Boolean).join(" ");
  return (
    <div className={cls("gcard sim")}>
      <Head icon={CalculatorIcon} title="Repayment simulation" meta="illustrative" />
      <div className="gc-b sim-b">
        <div className="ctrl">
          <div className="ctrl-top"><label htmlFor={id}>Amount</label><output htmlFor={id} className="o-amt">{lei(P)}</output></div>
          <input className="range sim-amt" id={id} type="range" {...AMT} value={P}
            style={{ "--p": `${((P - AMT.min) / (AMT.max - AMT.min)) * 100}%` } as CSSProperties}
            onChange={(e) => onChange({ ...c, amount: +e.target.value })} />
        </div>
        <div className="ctrl">
          <span className="label" id={tl}>Term</span>
          <div className="terms" role="group" aria-labelledby={tl}>
            {TERMS.map((t) => (
              <button key={t} type="button" aria-pressed={t === n} onClick={() => onChange({ ...c, term: t })}>{t} mo</button>
            ))}
          </div>
        </div>
        <div className="opts">
          <div className={optClass("loan")} data-k="loan">
            <div className="opt-h"><RecBadge hidden={rec.k !== "loan"} />Personal loan<span className="micro">{percent(c.rate)} fixed</span></div>
            <div className="big">{fmt(s.loan.monthly)} lei<small>/ month</small></div>
            <div className="kv"><span>Total cost</span><b>{lei(s.loan.cost)}</b></div>
            <div className="costbar"><span style={{ transform: `scaleX(${s.loan.cost / max})` }} /></div>
          </div>
          <div className={optClass("od")} data-k="od">
            <div className="opt-h"><RecBadge hidden={rec.k !== "od"} />Overdraft<span className="micro">11.5% variable</span></div>
            <div className="big">{ok ? <>{fmt(s.overdraft.monthly)} lei<small>/ month</small></> : "—"}</div>
            <div className="kv"><span>Total cost</span><b>{ok ? lei(s.overdraft.cost) : "n/a"}</b></div>
            <div className="costbar"><span style={{ transform: `scaleX(${ok ? s.overdraft.cost / max : 0})` }} /></div>
            <p className="opt-note" hidden={ok}>
              {P > 15000 ? "Overdraft limits go up to 15,000 lei." : "Overdrafts renew every 12 months, so they don’t fit longer terms."}
            </p>
          </div>
        </div>
        <p className="sim-say">
          <span className="ava-raiffy" aria-hidden="true"><CompassIcon /></span>
          <span className="say" aria-live="polite">
            <b style={{ fontWeight: 600 }}>I recommend {rec.name}.</b> {rec.reasons.join(" ")}
            <span className="alt">{rec.alt} The choice is yours.</span>
          </span>
        </p>
      </div>
    </div>
  );
}

function SaveRow({ icon: Icon, nm, ds, rt, liq, on, tag }: { icon: LucideIcon; nm: string; ds: string; rt: string; liq: number; on?: boolean; tag?: string }) {
  return (
    <div className={on ? "save on" : "save"}>
      {tag && <span className="save-tag pill" style={{ "--c": "#8A6A00", background: "#FFF3C4" } as CSSProperties}>{tag}</span>}
      <span className="ic"><Icon /></span>
      <div><div className="nm">{nm}</div><div className="ds">{ds}</div></div>
      <div className="rt">{rt}<div className="liq" aria-label={`Access: ${liq} of 4`}>{[1, 2, 3, 4].map((i) => <i key={i} className={i <= liq ? "f" : undefined} />)}</div></div>
    </div>
  );
}

function SavingsCard({ cls }: { cls: (b: string) => string }) {
  return (
    <div className={cls("gcard")}>
      <Head icon={PiggyBankIcon} title="Where to keep 15,000 lei" meta="rates 28 Oct" />
      <div className="gc-b">
        <div className="saves">
          <SaveRow icon={WalletIcon} nm="Current account" ds="Instant access" rt="0.05%" liq={4} />
          <SaveRow icon={PiggyBankIcon} nm="Savings account" ds="Withdraw anytime, no penalties" rt="3.5%" liq={3} on tag="Fits: access within a week" />
          <SaveRow icon={LockIcon} nm="Term deposit · 6 months" ds="Locked until 28 Apr · early exit loses interest" rt="5.6%" liq={1} />
          <SaveRow icon={LandmarkIcon} nm="Government bonds · 1 year" ds="Early sale at market price" rt="6.2%" liq={2} />
        </div>
        <div className="legend"><span className="liq"><i className="f" /><i className="f" /><i /><i /></span>how easily you can take the money out</div>
      </div>
    </div>
  );
}

function FeeCard({ cls }: { cls: (b: string) => string }) {
  return (
    <div className={cls("gcard")}>
      <Head icon={ReceiptIcon} title="October statement" meta="••4821" />
      <div className="gc-b">
        <div className="stmt">
          <div className="line dim"><span>Lidl Pipera<span className="dsc">Card payment · 24 Oct</span></span><span className="amt">−186.40</span></div>
          <div className="line sel"><span>ATM withdrawal fee<span className="dsc">Another bank’s ATM · 22 Oct</span></span><span className="amt">−5.00</span></div>
          <div className="line dim"><span>Account package<span className="dsc">Monthly · 1 Oct</span></span><span className="amt">−9.00</span></div>
        </div>
        <div className="why">
          <div className="why-row"><CircleHelpIcon /><span><b style={strong}>Why:</b> your package covers Raiffeisen ATMs only. Other banks’ ATMs cost 5 lei per withdrawal.</span></div>
          <div className="why-row tip"><MapPinIcon /><span><b style={strong}>Next time:</b> Raiffeisen ATM, Str. Barbu Văcărescu 164, 350 m from where you were.</span></div>
        </div>
      </div>
    </div>
  );
}

const SLOTS = ["Mon 09:00", "Tue 10:30", "Wed 15:00", "Thu 12:00"];

function DocsCard({ card: c, cls, onChange, announce }: Props & { card: CardOf<"docs">; cls: (b: string) => string }) {
  return (
    <div className={cls("gcard docs-card")}>
      <Head icon={ListChecksIcon} title="Before your loan meeting" meta={c.uploaded ? "3 of 3 ready" : "2 of 3 ready"} metaClass="micro dc-count" />
      <div className="gc-b docs">
        <div>
          <div className="prog"><span style={{ transform: c.uploaded ? "none" : "scaleX(.66)" }} /></div>
          <div className="cks">
            <div className="ck"><span className="bx ok"><CheckIcon /></span><span>ID card<small>Scanned in the app · valid until 2031</small></span><span className="micro">Done</span></div>
            <div className="ck"><span className="bx ok"><CheckIcon /></span><span>Proof of income<small>From your employer, issued 21 Oct</small></span><span className="micro">Done</span></div>
            <div className="ck ck-addr">
              <span className={c.uploaded ? "bx ok" : "bx"}>{c.uploaded && <CheckIcon />}</span>
              <span>Proof of address<small>{c.uploaded ? "Enel bill, 8 Oct · added just now" : "Utility bill from the last 3 months"}</small></span>
              {c.uploaded ? <span className="micro">Uploaded</span> : (
                <button type="button" className="btn btn-ghost up"
                  onClick={() => { onChange({ ...c, uploaded: true }); announce("Proof of address uploaded. All documents ready."); }}>
                  <UploadIcon />Upload
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="book">
          {c.booked ? (
            <div className="booked"><CalendarCheckIcon /><span><b>Booked: {c.booked.when}</b> with Andreea M., Floreasca branch. {c.booked.share ? "Raiffy’s summary will be shared before the meeting." : "No summary shared."}</span></div>
          ) : (
            <>
              <div className="adv"><span className="ava" aria-hidden="true">AM</span><div><b>Andreea M., personal advisor</b><span className="micro">Floreasca branch · or video call</span></div></div>
              <div className="slots" role="group" aria-label="Choose a time">
                {SLOTS.map((t) => <button key={t} type="button" aria-pressed={c.slot === t} onClick={() => onChange({ ...c, slot: t })}>{t}</button>)}
              </div>
              <label className="check">
                <input type="checkbox" className="share" checked={!!c.share} onChange={(e) => onChange({ ...c, share: e.target.checked })} />
                <span><b>Share Raiffy’s summary with Andreea</b><br />Only this conversation, only for this meeting.</span>
              </label>
              <div className="book-row">
                <button type="button" className="btn btn-dark btn-sm do-book" disabled={!c.slot}
                  onClick={() => { if (!c.slot) return; onChange({ ...c, booked: { when: c.slot, share: !!c.share } }); announce(`Meeting booked for ${c.slot}.`); }}>
                  <CalendarCheckIcon />Book meeting
                </button>
                <span className="micro">{c.slot ? `${c.slot} with Andreea M.` : "Pick a time first"}</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function HandoffCard({ onAsk, cls }: { onAsk: (t: string) => void; cls: (b: string) => string }) {
  return (
    <div className={cls("gcard handoff")}>
      <span className="ic"><HeadsetIcon /></span>
      <div>
        <h3>This needs a human advisor</h3>
        <p>Tax on deposit interest depends on your income and residency. An advisor can answer for your situation.</p>
        <div className="book-row">
          <button type="button" className="btn btn-dark btn-sm" onClick={() => onAsk("Book an advisor meeting")}><CalendarIcon />Book an advisor</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onAsk("Compare savings options instead")}>Not now</button>
        </div>
      </div>
    </div>
  );
}
