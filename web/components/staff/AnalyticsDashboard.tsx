"use client";

import { useQuery } from "convex/react";
import { ChevronRightIcon, CircleDashedIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { analyticsApi, type AnalyticsFilter, type AnalyticsSummary, type DataSource } from "@/lib/admin-api";
import type { StaffMe } from "./AdminPage";
import { Card, Count, Share, ShareRows } from "./SentimentDashboard";
import { AdminNav } from "./StaffNav";
import { StaffShell, initials } from "./StaffShell";

/*
 * admin.html#analytics over convex/analytics.ts summary: how answers use customers' account data. Aggregates only,
 * groups under the minimum hidden. Offers, applications, contracts, reminders and money saved need outcome events,
 * which aren't connected yet, so they're listed as such instead of shown as zeros.
 */

const SOURCE_LABEL: Record<DataSource, string> = {
  loans: "Existing loans", limits: "Card and overdraft limits", productsHeld: "Products held", preApproved: "Pre-approved offers",
  deposits: "Deposits and savings", feesCharged: "Fees charged", ageResidency: "Age and residency", idStatus: "Identity verification",
  contractEvents: "Applications and contracts", transactions: "Income and spending",
};
const NOT_CONNECTED = [
  "Pre-approved offers: shown, opened, applied and expired",
  "Applications and contracts, and the money-saved ledger",
  "Affordability checks, and the fixed-rate-ending and deposit-maturity reminders",
  "Fee questions answered without a handoff",
  "Eligibility limits by product, and digital or branch applications",
];

const num = new Intl.NumberFormat("en-GB");
const shortFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const asDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

function Daily({ daily, min }: { daily: AnalyticsSummary["daily"]; min: number }) {
  const max = Math.max(...daily.map((d) => d.answers)) || 1;
  const nice = Math.max(10, Math.ceil(max / 10) * 10);
  return (
    <section className="gcard sec" aria-labelledby="an-vol-h">
      <div className="gc-h"><span id="an-vol-h">Answers per day</span><span className="an-from">Days under {min} answers show as 0</span></div>
      <div className="gc-b">
        <div className="vol">
          <div className="vol-y" aria-hidden="true">{[nice, nice / 2, 0].map((t) => <span key={t} style={{ top: `${100 - t / nice * 100}%` }}>{num.format(t)}</span>)}</div>
          <div className="vol-plot">
            <span className="gl" style={{ top: 0 }} /><span className="gl" style={{ top: "50%" }} /><span className="gl" style={{ bottom: 0 }} />
            <div className="vol-bars" role="img" aria-label={`Answers per day, up to ${num.format(max)}. The data table below has every day.`}>
              {daily.map((d) => <b key={d.date}><i style={{ "--h": `${(d.answers / nice * 100).toFixed(1)}%` } as React.CSSProperties} /></b>)}
            </div>
          </div>
          <div className="vol-x" aria-hidden="true">
            <span>{shortFmt.format(asDate(daily[0]!.date))}</span><span>{shortFmt.format(asDate(daily[Math.floor(daily.length / 2)]!.date))}</span><span>{shortFmt.format(asDate(daily.at(-1)!.date))}</span>
          </div>
        </div>
      </div>
      <details className="tv">
        <summary><ChevronRightIcon />Data table</summary>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Date</th><th className="r">Answers</th><th className="r">Conversations</th></tr></thead>
            <tbody>{[...daily].reverse().map((d) => (
              <tr key={d.date}><td className="mono" style={{ fontSize: 12 }}>{shortFmt.format(asDate(d.date))}</td><td className="r mono">{num.format(d.answers)}</td><td className="r mono">{num.format(d.conversations)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

type Filters = { range: 7 | 30 | 90; track: "all" | "personal" | "business" };

export function AnalyticsDashboard({ me }: { me: StaffMe }) {
  const [f, setF] = useState<Filters>({ range: 30, track: "all" });
  const filter = useMemo<AnalyticsFilter>(() => {
    const today = new Date();
    return { from: isoDay(new Date(today.getTime() - (f.range - 1) * 86_400_000)), to: isoDay(today), track: f.track === "all" ? undefined : f.track };
  }, [f]);
  const s = useQuery(analyticsApi.summary, filter);

  const seg = <K extends keyof Filters>(key: K, label: string, opts: [Filters[K], string][]) => (
    <div className="seg" role="group" aria-label={label}>
      {opts.map(([v, text]) => <button key={String(v)} type="button" aria-pressed={f[key] === v} onClick={() => setF((x) => ({ ...x, [key]: v }))}>{text}</button>)}
    </div>
  );

  return (
    <StaffShell logoHref="/admin" nav={<AdminNav current="analytics" />} me={{ ...me, initials: initials(me.name) }}
      crumbs={[{ label: "Admin", href: "/admin" }, { label: "Analytics" }]}>
      <div className="pg-head">
        <div>
          <h2>Analytics</h2>
          <p>How Raiffy’s answers use customers’ account data. Only totals: no customer can be picked out, and groups under {s?.minCount ?? 10} are hidden. Account data is sample data in this preview.</p>
        </div>
      </div>
      <div className="filters">
        {seg("range", "Range", [[7, "7 days"], [30, "30 days"], [90, "90 days"]])}
        {seg("track", "Track", [["all", "All"], ["personal", "Individuals"], ["business", "Business"]])}
      </div>

      {!s ? <p className="micro" role="status">Loading…</p> : (
        <div aria-live="polite">
          {s.kpis.answers === null && <p className="check-line">Not enough answers in this range yet. Counts appear once a group reaches {s.minCount}.</p>}
          <div className="kpis" style={{ "--n": 4 } as React.CSSProperties}>
            <div className="kpi"><div className="k">Conversations</div><div className="v"><Count value={s.kpis.conversations} /></div><div className="s"><Count value={s.kpis.answers} /> answers</div></div>
            <div className="kpi"><div className="k">Used account data</div><div className="v"><Share value={s.kpis.accountDataShare} /></div><div className="s">of answers</div></div>
            <div className="kpi"><div className="k">Passed checks first time</div><div className="v"><Share value={s.quality.firstPassShare} /></div><div className="s">of answers</div></div>
            <div className="kpi"><div className="k">Fallbacks</div><div className="v"><Count value={s.quality.fallbacks} /></div><div className="s"><Count value={s.quality.escalations} /> sent to a person</div></div>
          </div>

          <Daily daily={s.daily} min={s.minCount} />

          <div className="an-grid sec">
            <Card title="Account data used in answers" from="Share of all answers">
              <ShareRows cols="minmax(140px,200px) minmax(0,1fr) 64px 44px"
                rows={s.dataUsage.map((u) => ({ key: u.source, label: SOURCE_LABEL[u.source], count: u.answers, share: u.share }))} />
            </Card>
            <Card title="Not connected yet" from="Needs outcome events">
              <div style={{ display: "grid", gap: 8 }}>
                {NOT_CONNECTED.map((x) => <p key={x} className="micro" style={{ display: "flex", gap: 8, alignItems: "flex-start" }}><CircleDashedIcon aria-hidden="true" width={13} height={13} style={{ flex: "none", marginTop: 2 }} />{x}</p>)}
              </div>
              <p className="micro" style={{ marginTop: 12 }}>These sections appear once the bank’s offer, application and contract events reach Raiffy. Answers blocked by stale values aren’t counted yet either.</p>
            </Card>
          </div>
        </div>
      )}
    </StaffShell>
  );
}
