"use client";

import { Fragment, useId, useState, type CSSProperties, type ReactNode } from "react";
import { CalculatorIcon, CheckIcon, CompassIcon, HeadsetIcon, ListChecksIcon, ReceiptIcon, ScaleIcon, SignpostIcon, type LucideIcon } from "lucide-react";
import { monthlyPayment } from "@/lib/finance";
import { fmt, lei } from "@/lib/format";
import { CARD_TYPES, type AnswerCardBlock, type CardFact, type CardRecommendation, type Source, type UiBlock } from "@/lib/agent-api";

/*
 * Answer cards for the live chat, filled by the model as JSON (lib/agent/blocks.ts) and rendered with the demo cards'
 * classes (components/chat/cards.tsx) plus the answer-card hierarchy (DESIGN.md §11): a 16px title with its sources
 * under it, the icon on a yellow tint, one lead figure per card on a --tint-hl band, and 15px values. Yellow is only
 * ever light. Every figure keeps the number of its source chip.
 */

// The routes block reshaped from the answer text carries a "state"; the chat shows that list in the text itself.
export const isAnswerCard = (b: UiBlock): b is AnswerCardBlock => (CARD_TYPES as readonly string[]).includes(b.type) && !("state" in b);

type Cite = (url?: string) => ReactNode;
type Sub = (urls: (string | undefined)[]) => string | undefined;

export const RecBadge = () => <span className="rec-badge"><span className="rec-dot" aria-hidden="true" />Recommended</span>;
const NOTE = "Dated public information, not a personal offer. The choice is yours.";

export function CardHead({ icon: Icon, title, sub, meta }: { icon: LucideIcon; title: string; sub?: string; meta?: string }) {
  return (
    <div className="gc-h ac-h">
      <span className="ac-ic" aria-hidden="true"><Icon /></span>
      <span className="ac-t"><span className="ac-title" title={title}>{title}</span>{sub && <span className="ac-sub">{sub}</span>}</span>
      {meta && <span className="micro">{meta}</span>}
    </div>
  );
}

/** The one figure a card leads with: label above, value large in ink, on a band of yellow light. */
export function Lead({ label, children, note }: { label: string; children: ReactNode; note?: string }) {
  return (
    <div className="ac-lead">
      <span className="ac-lead-l">{label}</span>
      <span className="ac-lead-v">{children}</span>
      {note && <span className="ac-lead-n">{note}</span>}
    </div>
  );
}

export function AnswerCards({ blocks, sources, onAsk }: { blocks: UiBlock[]; sources: Source[]; onAsk: (text: string) => void }) {
  const cards = blocks.filter(isAnswerCard);
  if (!cards.length) return null;
  const cite: Cite = (url) => {
    const i = url ? sources.findIndex(s => s.url === url) : -1;
    if (i < 0) return null;
    const s = sources[i]!;
    if (!/^https?:/i.test(s.url)) return <span className="cite" aria-label={`Source ${i + 1}: ${s.title}`} title={s.title}>{i + 1}</span>;
    return <a className="cite" href={s.url} target="_blank" rel="noreferrer" aria-label={`Source ${i + 1}: ${s.title}`} title={s.title}>{i + 1}</a>;
  };
  // "2 sources · 28 Oct": how many sources a card's figures come from, and when the newest was collected
  const sub: Sub = (urls) => {
    const used = sources.filter(s => urls.includes(s.url));
    if (!used.length) return undefined;
    const newest = used.map(s => s.collectedOn).sort().at(-1)!;
    const date = new Date(`${newest}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
    return `${used.length} ${used.length === 1 ? "source" : "sources"} · ${date}`;
  };
  return (
    <div className="answer-cards">
      {cards.map((c, i) => <Card key={i} card={c} cite={cite} sub={sub} onAsk={onAsk} />)}
    </div>
  );
}

function Card({ card, cite, sub, onAsk }: { card: AnswerCardBlock; cite: Cite; sub: Sub; onAsk: (text: string) => void }) {
  switch (card.type) {
    case "comparison": return <Comparison card={card} cite={cite} sub={sub} />;
    case "routes": return <Routes card={card} cite={cite} sub={sub} />;
    case "simulation": return <Simulation card={card} cite={cite} sub={sub} />;
    case "keyFacts": {
      const [first, ...rest] = card.facts;
      return (
        <div className="gcard">
          <CardHead icon={ReceiptIcon} title={card.title} sub={sub(card.facts.map(f => f.source))} />
          <div className="gc-b ac-body">
            {first && <Lead label={first.label}>{first.value}{cite(first.source)}</Lead>}
            {rest.length > 0 && <div className="kv-list">{rest.map((f, i) => <Fact key={i} fact={f} cite={cite} />)}</div>}
          </div>
          <div className="gc-note">{NOTE}</div>
        </div>
      );
    }
    case "checklist": return (
      <div className="gcard">
        <CardHead icon={ListChecksIcon} title={card.title} sub={sub(card.items.map(it => it.source))}
          meta={`${card.items.length} ${card.items.length === 1 ? "item" : "items"}`} />
        <div className="gc-b">
          <ol className="cks plain">
            {card.items.map((it, i) => (
              <li key={i} className="ck"><span className="bx num" aria-hidden="true">{i + 1}</span>
                <span className="ck-t">{it.text}{cite(it.source)}{it.detail && <small>{it.detail}</small>}</span><span /></li>
            ))}
          </ol>
        </div>
      </div>
    );
    case "handoff": return (
      <div className="gcard handoff">
        <span className="ic"><HeadsetIcon /></span>
        <div>
          <h3>{card.title}</h3>
          <p>{card.reason}</p>
          <div className="book-row">
            <button type="button" className="btn btn-dark btn-sm" onClick={() => onAsk("I'd like to talk to a specialist about this.")}>Talk to a specialist</button>
          </div>
        </div>
      </div>
    );
  }
}

function Fact({ fact, cite }: { fact: CardFact; cite: Cite }) {
  return <div className="kv fact"><span>{fact.label}</span><b>{fact.value}{cite(fact.source)}</b></div>;
}

/** Figures as in chat.html's plan card (.plan-figs): the label above, the value below. The first one leads. */
function Figs({ facts, cite }: { facts: CardFact[]; cite: Cite }) {
  if (!facts.length) return null;
  return (
    <dl className="figs">
      {facts.map((f, i) => <div key={i} className={i === 0 ? "lead" : undefined}><dt>{f.label}</dt><dd>{f.value}{cite(f.source)}</dd></div>)}
    </dl>
  );
}

export function Why({ rec }: { rec: CardRecommendation }) {
  return (
    <div className="rec-why">
      <div className="rec-why-h"><span className="ava-raiffy" aria-hidden="true"><CompassIcon /></span>Why I recommend {rec.option}</div>
      <ul>{rec.reasons.map(t => <li key={t}><CheckIcon /><span>{t}</span></li>)}</ul>
      <p className="rec-alt">{rec.whenOther} Every option stays open, and the choice is yours.</p>
    </div>
  );
}

/** The row a comparison is decided on: total cost first, then the APR or the rate. Lower wins on these. */
const DECIDING = [/total|cost|cost total/i, /\b(DAE|APR)\b/i, /rate|interest|dob[aâ]nd/i];
const firstNumber = (v: string) => { const m = /\d+(?:[.,]\d+)*/.exec(v.replace(/(\d)[ .,](?=\d{3}\b)/g, "$1")); return m ? Number(m[0].replace(",", ".")) : NaN; };

/** One row per fact label, the deciding row first; a missing value reads "Not in the sources". */
function Comparison({ card, cite, sub }: { card: Extract<AnswerCardBlock, { type: "comparison" }>; cite: Cite; sub: Sub }) {
  const all = [...new Set(card.options.flatMap(o => o.facts.map(f => f.label)))];
  const deciding = DECIDING.map(re => all.find(l => re.test(l))).find(Boolean);
  const labels = deciding ? [deciding, ...all.filter(l => l !== deciding)] : all;
  // The lowest value on the deciding row gets the yellow light, when every option has a comparable figure
  const values = deciding ? card.options.map(o => firstNumber(o.facts.find(f => f.label === deciding)?.value ?? "")) : [];
  const best = values.length && values.every(Number.isFinite) && new Set(values).size > 1 ? Math.min(...values) : null;
  const rec = card.recommendation?.option;
  const cls = (name: string, ...extra: (string | false)[]) => [name === rec && "rc", ...extra].filter(Boolean).join(" ") || undefined;
  return (
    <div className="gcard">
      <CardHead icon={ScaleIcon} title={card.title} sub={sub(card.options.flatMap(o => o.facts.map(f => f.source)))} meta={`${card.options.length} options`} />
      <div className="tbl-wrap">
        <div className="cmp" data-cols={card.options.length} role="table" aria-label={card.title}>
          <div className="th" role="columnheader" />
          {card.options.map(o => (
            <div key={o.name} className={cls(o.name, "th")} role="columnheader">{o.name === rec && <RecBadge />}{o.name}
              {o.provider && <small>{o.provider}</small>}</div>
          ))}
          {labels.map(label => (
            <Fragment key={label}>
              <div className={label === deciding ? "rk lead" : "rk"} role="rowheader">{label}</div>
              {card.options.map((o, i) => {
                const f = o.facts.find(x => x.label === label);
                const lead = label === deciding;
                return (
                  <div key={o.name} role="cell" className={cls(o.name, lead && "lead", lead && best !== null && values[i] === best && "win")}>
                    {f ? <>{f.value}{cite(f.source)}</> : <span className="na">Not in the sources</span>}
                  </div>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
      {card.recommendation ? <Why rec={card.recommendation} /> : <div className="gc-note">{NOTE}</div>}
    </div>
  );
}

/**
 * Two routes sit side by side (chat.html .opts); three or four stack as full-width rows (chat.html .saves), so no
 * route is left alone on a row. The recommended route comes first.
 */
function Routes({ card, cite, sub }: { card: Extract<AnswerCardBlock, { type: "routes" }>; cite: Cite; sub: Sub }) {
  const rec = card.recommendation.option;
  const routes = [...card.routes].sort((a, b) => Number(b.name === rec) - Number(a.name === rec));
  const stacked = routes.length > 2;
  return (
    <div className="gcard">
      <CardHead icon={SignpostIcon} title={card.title} sub={sub(card.routes.flatMap(r => r.facts.map(f => f.source)))} meta={`${card.routes.length} routes`} />
      <div className="gc-b">
        <div className={stacked ? "routes" : "opts"}>
          {routes.map(r => (
            <div key={r.name} className={`${stacked ? "route" : "opt"}${r.name === rec ? " rec" : ""}`}>
              <div className="route-main">
                <div className="opt-h">
                  {(r.name === rec || r.chosen) && (
                    <span className="ac-tags">{r.name === rec && <RecBadge />}{r.chosen && <span className="pill choice-pill">Your choice</span>}</span>
                  )}
                  <span className="ac-name">{r.name}</span><span className="micro">{r.summary}</span>
                </div>
                <p className="opt-note">{r.fit}</p>
              </div>
              <Figs facts={r.facts} cite={cite} />
            </div>
          ))}
        </div>
      </div>
      <Why rec={card.recommendation} />
    </div>
  );
}

/*
 * Repayment simulation: the cited rate (or range) is the only bank figure; payments and totals are computed here.
 * With the customer's income it shows the payment as a share of it, and a published debt-ratio limit only when a
 * source states one. It never says whether the customer is eligible: the bank's analysis decides.
 */
const SIM_TERMS = [12, 24, 36, 48, 60, 84, 120];
const EXAMPLE = { amount: 20_000, months: 60 };
const pct = (x: number) => `${Math.round(x * 100)}%`;
const span = (lo: string, hi?: string) => (hi && hi !== lo ? `${lo} – ${hi}` : lo);

function Simulation({ card, cite, sub }: { card: Extract<AnswerCardBlock, { type: "simulation" }>; cite: Cite; sub: Sub }) {
  const id = useId(), tl = useId();
  const longest = card.termMaxMonths ?? 60;
  const [amount, setAmount] = useState(card.amount ?? EXAMPLE.amount);
  const [term, setTerm] = useState(card.months ?? Math.min(EXAMPLE.months, longest));
  const max = Math.max(100_000, Math.ceil((card.amount ?? 0) * 2 / 10_000) * 10_000);
  const range = { min: 1_000, max, step: max > 50_000 ? 1_000 : 500 };
  const terms = [...new Set([...SIM_TERMS.filter((t) => t <= longest), ...(card.months ? [card.months] : [])])].sort((a, b) => a - b);
  // Payments at the lowest and, for a range, the highest published rate
  const at = (ratePercent: number) => { const m = monthlyPayment(amount, ratePercent / 100, term); return { monthly: m, total: m * term }; };
  const low = at(card.ratePercent);
  const high = card.rateMaxPercent ? at(card.rateMaxPercent) : null;
  const money = (pick: (x: { monthly: number; total: number }) => number) => span(fmt(pick(low)), high ? fmt(pick(high)) : undefined);
  const share = card.income ? (x: { monthly: number }) => (x.monthly + (card.obligations ?? 0)) / card.income! : null;
  const rate = span(`${card.ratePercent}%`, card.rateMaxPercent ? `${card.rateMaxPercent}%` : undefined);
  const given = [card.amount !== undefined && "amount", card.months !== undefined && "term", card.income !== undefined && "income"].filter(Boolean);
  return (
    <div className="gcard sim">
      <CardHead icon={CalculatorIcon} title={card.title} sub={[card.product, sub([card.source, card.maxDebtRatio?.source])].filter(Boolean).join(" · ")} meta="indicative" />
      <div className="gc-b sim-b">
        <div className="ctrl">
          <div className="ctrl-top"><label htmlFor={id}>Amount</label><output htmlFor={id} className="o-amt">{lei(amount)}</output></div>
          <input className="range sim-amt" id={id} type="range" {...range} value={amount}
            style={{ "--p": `${((amount - range.min) / (range.max - range.min)) * 100}%` } as CSSProperties}
            onChange={(e) => setAmount(+e.target.value)} />
        </div>
        <div className="ctrl">
          <span className="label" id={tl}>Term</span>
          <div className="terms" role="group" aria-labelledby={tl}>
            {terms.map((t) => <button key={t} type="button" aria-pressed={t === term} onClick={() => setTerm(t)}>{t} mo</button>)}
          </div>
        </div>
        <div aria-live="polite" className="sim-out">
          <Lead label={`Monthly payment at ${rate} interest`} note={high ? "At the lowest and the highest published rate" : undefined}>
            {money((x) => x.monthly)} lei<small>/ month</small>{cite(card.source)}
          </Lead>
          {card.rateFor && <p className="opt-note sim-for">{card.rateFor}</p>}
          <div className="kv-list">
            <div className="kv fact"><span>Total repaid</span><b>{money((x) => x.total)} lei</b></div>
            <div className="kv fact"><span>Of which interest</span><b>{money((x) => x.total - amount)} lei</b></div>
            {share && (
              <div className="kv fact">
                <span>Share of your {fmt(card.income!)} lei income{card.obligations === undefined ? ", before other loan and card payments" : ", with your other payments"}</span>
                <b>{span(pct(share(low)), high ? pct(share(high)) : undefined)}</b>
              </div>
            )}
            {share && card.maxDebtRatio && (
              <div className="kv fact"><span>Limit in the bank&apos;s published conditions</span><b>{card.maxDebtRatio.percent}% of income{cite(card.maxDebtRatio.source)}</b></div>
            )}
            {card.fees?.map((f, i) => <Fact key={i} fact={f} cite={cite} />)}
          </div>
        </div>
      </div>
      <div className="gc-note">
        {given.length ? `Starts from the ${given.join(" and ")} you gave` : "Starts from an example amount"}
        {card.months === undefined ? `; the ${term}-month term is an example. ` : ". "}
        Interest only: fees and the APR (DAE) aren&apos;t included. Your rate, and whether you can borrow, come from the bank&apos;s own analysis.
      </div>
    </div>
  );
}
