"use client";

import { useQuery } from "convex/react";
import { ChevronRightIcon } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { MIN_GROUP, sentimentApi, type SentimentFilter, type SentimentSummary } from "@/lib/sentiment-api";
import { AdminNav } from "./StaffNav";
import { StaffShell, initials } from "./StaffShell";

/*
 * admin.html#sentiment over convex/sentiment.ts summary. Aggregates only; the backend hides any group under the
 * minimum and checks the admin role again on every read.
 */

const SENTIMENT_LABEL = { positive: "Positive", neutral: "Neutral", confused: "Confused", frustrated: "Frustrated", angry: "Angry" } as const;
const ABOUT_LABEL = { answer: "Raiffy’s answer", price: "A rate, fee or price", service: "The bank’s service", app: "The app or a payment" } as const;
const AFTER_LABEL = {
  first: "Nothing yet, first message", answered: "A checked answer", unavailable: "An answer it couldn’t give", failed: "A reply that failed",
  stopped: "A reply the customer stopped", menu: "A “Which of these is closest?” menu", repeat: "The same question, asked again",
} as const;
const REASON_LABEL = { wrong: "Wrong", unclear: "Unclear", missing: "Missing information", other: "Something else" } as const;
const INQUIRY_LABEL: Record<string, string> = {
  purchase_goal: "Buying something", affordability: "Can I afford it?", debt_refinancing: "Refinancing", product_comparison: "Comparing products",
  product_explanation: "Explaining a product", fees_statements: "Fees and statements", saving_goal: "Saving", listing: "Listing products",
  cash_shortfall: "Short of cash", life_event: "A life event", negotiation: "Negotiating a price", unknown: "Not routed",
};

const num = new Intl.NumberFormat("en-GB");
const pctFmt = new Intl.NumberFormat("en-GB", { style: "percent", maximumFractionDigits: 0 });
const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const shortFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const asDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export function Count({ value }: { value: number | null }) {
  return value === null ? <span className="supp" title={`Hidden: fewer than ${MIN_GROUP} customers`}>&lt;{MIN_GROUP}</span> : <>{num.format(value)}</>;
}
export function Share({ value }: { value: number | null }) {
  return value === null ? <span className="supp" title="Hidden: too few to show">—</span> : <>{pctFmt.format(value)}</>;
}

export type Row = { key: string; label: string; count: number | null; share: number | null };
export function ShareRows({ rows, cols = "minmax(110px,160px) minmax(0,1fr) 64px 44px" }: { rows: Row[]; cols?: string }) {
  const top = Math.max(...rows.map((r) => r.share ?? 0)) || 1;
  return (
    <div className="fn">
      {rows.map((r) => (
        <div key={r.key} className="fn-row" style={{ gridTemplateColumns: cols }}>
          <span className="lb" title={r.label}>{r.label}</span>
          <span className="tr" aria-hidden="true"><i style={{ "--w": `${((r.share ?? 0) / top * 100).toFixed(1)}%` } as React.CSSProperties} /></span>
          <span className="ct"><Count value={r.count} /></span>
          <span className="pc">{r.share === null ? "" : pctFmt.format(r.share)}</span>
        </div>
      ))}
    </div>
  );
}

export function Card({ title, from, children }: { title: string; from: string; children: React.ReactNode }) {
  return (
    <section className="gcard" aria-label={title}>
      <div className="gc-h"><span>{title}</span><span className="an-from">{from}</span></div>
      <div className="gc-b">{children}</div>
    </section>
  );
}

function Daily({ daily, from, to }: { daily: SentimentSummary["daily"]; from: string; to: string }) {
  const [hover, setHover] = useState<{ i: number; left: number } | null>(null);
  const plot = useRef<HTMLDivElement>(null);
  const max = Math.max(...daily.map((d) => d.negative ?? 0)) || 0.1;
  const nice = Math.ceil(max * 20) / 20;
  const show = (i: number, bar: HTMLElement) => {
    const pr = plot.current?.getBoundingClientRect(), br = bar.getBoundingClientRect();
    setHover({ i, left: pr ? Math.max(0, Math.min(pr.width - 160, br.left - pr.left + br.width / 2 - 80)) : 0 });
  };
  const d = hover === null ? null : daily[hover.i];
  return (
    <section className="gcard sec" aria-labelledby="sn-vol-h">
      <div className="gc-h"><span id="sn-vol-h">Unhappy messages per day</span><span className="an-from">Share of customer messages · {dateFmt.format(asDate(from))} – {dateFmt.format(asDate(to))}</span></div>
      <div className="gc-b">
        <div className="vol">
          <div className="vol-y" aria-hidden="true">
            {[nice, nice / 2, 0].map((t) => <span key={t} style={{ top: `${100 - t / nice * 100}%` }}>{pctFmt.format(t)}</span>)}
          </div>
          <div className="vol-plot" ref={plot}>
            <span className="gl" style={{ top: 0 }} /><span className="gl" style={{ top: "50%" }} /><span className="gl" style={{ bottom: 0 }} />
            <div className={hover === null ? "vol-bars" : "vol-bars hovering"} role="img" onPointerLeave={() => setHover(null)}
              aria-label={`Share of unhappy customer messages per day, up to ${pctFmt.format(max)}. The data table below has every day.`}>
              {daily.map((x, i) => (
                <b key={x.date} className={hover?.i === i ? "on" : undefined} onPointerMove={(e) => { if (hover?.i !== i) show(i, e.currentTarget); }}>
                  <i style={{ "--h": `${((x.negative ?? 0) / nice * 100).toFixed(1)}%` } as React.CSSProperties} />
                </b>
              ))}
            </div>
            {d && (
              <div className="tip" style={{ left: hover?.left ?? 0, top: -8, transform: "translateY(-100%)" }}>
                <b>{dateFmt.format(asDate(d.date))}</b><span>{d.negative === null ? "Too few customers to show" : `${pctFmt.format(d.negative)} unhappy`}</span><br />
                <span>{d.turns === null ? "" : `${num.format(d.turns)} messages`}</span>
              </div>
            )}
          </div>
          <div className="vol-x" aria-hidden="true">
            <span>{shortFmt.format(asDate(from))}</span><span>{shortFmt.format(asDate(daily[Math.floor(daily.length / 2)]?.date ?? from))}</span><span>{shortFmt.format(asDate(to))}</span>
          </div>
        </div>
      </div>
      <details className="tv">
        <summary><ChevronRightIcon />Data table</summary>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Date</th><th className="r">Messages</th><th className="r">Positive</th><th className="r">Neutral</th><th className="r">Unhappy</th></tr></thead>
            <tbody>
              {[...daily].reverse().map((x) => (
                <tr key={x.date}>
                  <td className="mono" style={{ fontSize: 12 }}>{dateFmt.format(asDate(x.date))}</td>
                  <td className="r mono"><Count value={x.turns} /></td><td className="r mono"><Share value={x.positive} /></td>
                  <td className="r mono"><Share value={x.neutral} /></td><td className="r mono"><Share value={x.negative} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

type Filters = { range: 7 | 30 | 90; track: "all" | "personal" | "business"; entry: "all" | "web" | "smartMobile" };

export function SentimentDashboard({ me }: { me: { name: string; title: string } }) {
  const [f, setF] = useState<Filters>({ range: 30, track: "all", entry: "all" });
  const filter = useMemo<SentimentFilter>(() => {
    const today = new Date();
    const from = new Date(today.getTime() - (f.range - 1) * 86_400_000);
    return { from: isoDay(from), to: isoDay(today), track: f.track === "all" ? undefined : f.track, entry: f.entry === "all" ? undefined : f.entry };
  }, [f]);
  const s = useQuery(sentimentApi.summary, filter);

  const seg = <K extends keyof Filters>(key: K, label: string, opts: [Filters[K], string][]) => (
    <div className="seg" role="group" aria-label={label}>
      {opts.map(([v, text]) => (
        <button key={String(v)} type="button" aria-pressed={f[key] === v} onClick={() => setF((x) => ({ ...x, [key]: v }))}>{text}</button>
      ))}
    </div>
  );

  const confused = s?.mix.find((m) => m.sentiment === "confused");
  const downN = s ? s.reasons.reduce((t, r) => t + (r.votes ?? 0), 0) : 0;

  return (
    <StaffShell logoHref="/admin" nav={<AdminNav current="sentiment" />} me={{ ...me, initials: initials(me.name) }}
      crumbs={[{ label: "Admin", href: "/admin" }, { label: "Sentiment" }]}>
      <div className="pg-head">
        <div>
          <h2>Sentiment</h2>
          <p>How customers feel in their messages, labelled by Jev, and what came before the unhappy ones. Labels only: no message text is kept here, and groups under {s?.minCount ?? MIN_GROUP} customers are hidden.</p>
        </div>
      </div>
      <div className="filters">
        {seg("range", "Range", [[7, "7 days"], [30, "30 days"], [90, "90 days"]])}
        {seg("track", "Track", [["all", "All"], ["personal", "Individuals"], ["business", "Business"]])}
        {seg("entry", "Entry point", [["all", "All entry points"], ["web", "Web"], ["smartMobile", "Smart Mobile"]])}
      </div>
      {!s ? <p className="micro" role="status">Loading…</p> : (
        <div aria-live="polite">
          {s.kpis.conversations === null && (
            <p className="check-line">Not enough labelled chats in this range yet. Counts appear once at least {s?.minCount ?? MIN_GROUP} customers are in a group.</p>
          )}
          <div className="kpis" style={{ "--n": 4 } as React.CSSProperties}>
            <div className="kpi"><div className="k">Conversations labelled</div><div className="v"><Count value={s.kpis.conversations} /></div><div className="s"><Count value={s.kpis.turns} /> customer messages</div></div>
            <div className="kpi"><div className="k">With an unhappy message</div><div className="v"><Share value={s.kpis.negativeConversationShare} /></div><div className="s">confused, frustrated or angry</div></div>
            <div className="kpi"><div className="k">Confused</div><div className="v"><Share value={confused?.share ?? null} /></div><div className="s">of customer messages</div></div>
            <div className="kpi"><div className="k">Answers voted down</div><div className="v"><Share value={s.kpis.thumbsDownShare} /></div><div className="s">of <Count value={s.kpis.votes} /> rated answers</div></div>
          </div>

          <Daily daily={s.daily} from={filter.from} to={filter.to} />

          <div className="an-grid sec">
            <Card title="How customers feel" from="Share of customer messages">
              <ShareRows rows={s.mix.map((m) => ({ key: m.sentiment, label: SENTIMENT_LABEL[m.sentiment], count: m.turns, share: m.share }))} />
            </Card>
            <Card title="What unhappy messages were about" from="Share of unhappy messages">
              <ShareRows rows={s.about.map((a) => ({ key: a.about, label: ABOUT_LABEL[a.about], count: a.turns, share: a.share }))} />
            </Card>
          </div>

          <section className="gcard sec" aria-labelledby="sn-after-h">
            <div className="gc-h"><span id="sn-after-h">What came just before</span><span className="an-from">Raiffy’s previous reply · unhappy next messages and their share</span></div>
            <div className="gc-b">
              <ShareRows cols="minmax(140px,260px) minmax(0,1fr) 64px 44px"
                rows={s.after.map((a) => ({ key: a.after, label: AFTER_LABEL[a.after], count: a.negative, share: a.negativeShare }))} />
            </div>
          </section>

          <div className="an-grid sec">
            <Card title="By answer pattern" from="Messages · share unhappy">
              <ShareRows cols="minmax(120px,170px) minmax(0,1fr) 64px 44px"
                rows={s.byInquiry.map((r) => ({ key: r.key, label: INQUIRY_LABEL[r.key] ?? r.key, count: r.turns, share: r.negativeShare }))} />
            </Card>
            <Card title="Why answers were voted down" from="Optional reason after a thumbs down">
              <ShareRows rows={s.reasons.map((r) => ({ key: r.reason, label: REASON_LABEL[r.reason], count: r.votes, share: r.votes === null || !downN ? null : r.votes / downN }))} />
              <p className="micro" style={{ marginTop: 12 }}>Share of the reasons given. Most thumbs down come without one.</p>
            </Card>
          </div>
        </div>
      )}
    </StaffShell>
  );
}
