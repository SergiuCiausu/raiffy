"use client";

import { Fragment, type ReactNode } from "react";
import { ScaleIcon } from "lucide-react";
import type { CompareBlock, CompareCell, CompareRowKey, Source, UiBlock } from "@/lib/agent-api";
import { CardHead, RecBadge, Why } from "@/components/agent/AnswerCards";

/*
 * The comparison card's fixed rows (lib/compare, chat.html's bankcompare card; DESIGN.md → Bank comparison).
 * The rows, their order and every value come from the server; this only formats them in English. A gap is
 * "Not confirmed" or "Not in the sources", never zero. The yellow light marks only one cheaper exact option.
 */

export const isCompare = (b: UiBlock): b is CompareBlock => b.type === "compare_table";

const ROWS: Record<CompareRowKey, string> = {
  total_cost: "Total cost", monthly_payment: "Monthly payment", dae: "DAE in the bank’s example", interest_rate: "Interest rate",
  amount: "Amount", term: "Repayment term", origination_fee: "Analysis fee", administration_fee: "Administration fee",
  early_repayment_fee: "Early repayment fee", insurance: "Insurance", documents_always: "Always asked",
  documents_sometimes: "Sometimes asked", documents_online: "Needed to apply online",
};
const GROUPS = { cost: "Cost", amounts: "Amounts", commissions: "Commissions", documents: "Documents" } as const;
const FREQ = { once: " once", monthly: " a month", yearly: " a year" } as const;
const NOTE = "Dated public figures from each bank’s page, not a personal offer. The choice is yours.";

const number = (n: number) => new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 }).format(n);
function unit(n: number, u: string) {
  if (u === "bps") return `${number(n / 100)}%`;
  if (u === "minor_ron") return `${number(n / 100)} lei`;
  if (u === "minor_eur") return `${number(n / 100)} euro`;
  if (u === "months") return `${n} months`;
  if (u === "years") return `${n} years`;
  if (u === "days") return `${n} days`;
  return number(n);
}

/** One value as written on the card: "5.55–17.95%", "up to 50,000 euro, in lei", "5 lei a month", "None". */
export function cellLabel(cell: Extract<CompareCell, { state: "value" }>): string {
  const v = cell.value;
  const none = v.type === "exact" && cell.unit === "minor_ron" && v.amount === 0;
  const s = v.type === "exact" ? (none ? "None" : unit(v.amount, cell.unit))
    : v.type === "range" ? (cell.unit === "bps" ? `${number(v.min / 100)}–${unit(v.max, cell.unit)}` : `${unit(v.min, cell.unit)} – ${unit(v.max, cell.unit)}`)
    : v.type === "from" ? `from ${unit(v.min, cell.unit)}`
    : v.type === "up_to" ? `up to ${unit(v.max, cell.unit)}${cell.unit === "minor_eur" ? ", in lei" : ""}`
    : v.text;
  return `${s}${cell.frequency && !none ? FREQ[cell.frequency] : ""}`;
}

export function CompareTable({ block, sources }: { block: CompareBlock; sources: Source[] }) {
  const { table, recommendation: rec } = block;
  const cite = (url?: string): ReactNode => {
    const i = url ? sources.findIndex((s) => s.url === url) : -1;
    if (i < 0) return null;
    const s = sources[i]!;
    if (!/^https?:/i.test(s.url)) return <span className="cite" aria-label={`Source ${i + 1}: ${s.title}`} title={s.title}>{i + 1}</span>;
    return <a className="cite" href={s.url} target="_blank" rel="noreferrer" aria-label={`Source ${i + 1}: ${s.title}`} title={s.title}>{i + 1}</a>;
  };
  const urls = new Set(table.groups.flatMap((g) => g.rows.flatMap((r) => r.cells.flatMap((c) => (c.state === "value" && c.source ? [c.source.url] : [])))));
  const used = sources.filter((s) => urls.has(s.url));
  const newest = used.map((s) => s.collectedOn).sort().at(-1);
  const date = newest && new Date(`${newest}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const lit = table.best !== null;
  const notes = [
    ...(table.paymentUnavailable && table.scenario ? [`No monthly payment for ${number(table.scenario.amount / 100)} lei over ${table.scenario.months} months: each bank publishes its rate as a range, and your rate depends on the bank’s assessment.`] : []),
    ...(table.deciding === "dae" && !lit ? ["Each DAE is for that bank’s own example, so they aren’t compared directly."] : []),
    ...(rec ? [] : [NOTE]),
  ];

  return (
    <div className="answer-cards">
      <div className="gcard">
        <CardHead icon={ScaleIcon} title={block.title} sub={used.length ? `${used.length} ${used.length === 1 ? "source" : "sources"}${date ? ` · ${date}` : ""}` : undefined}
          meta={`${table.products.length} options`} />
        <div className="tbl-wrap">
          <div className="cmp cmp-rows" data-cols={table.products.length} role="table" aria-label={block.title}>
            <div className="th" role="columnheader" />
            {table.products.map((p) => (
              <div key={p.name} className={p.name === rec?.option ? "th rc" : "th"} role="columnheader">
                {p.name === rec?.option && <RecBadge />}{p.name}{p.provider && <small>{p.provider}</small>}
              </div>
            ))}
            {table.groups.map((g) => (
              <Fragment key={g.key}>
                <div className="cg" role="rowheader">{GROUPS[g.key]}</div>
                {g.rows.map((r) => {
                  const lead = r.key === table.deciding;
                  return (
                    <Fragment key={r.key}>
                      <div className={lead ? "rk lead" : "rk"} role="rowheader">{ROWS[r.key]}</div>
                      {r.cells.map((c, i) => {
                        const name = table.products[i]!.name;
                        const cls = [name === rec?.option && "rc", lead && "lead", lead && lit && table.best === i && "win"].filter(Boolean).join(" ");
                        return (
                          <div key={name} role="cell" className={cls || undefined}>
                            {c.state === "value" ? <>{cellLabel(c)}{cite(c.source?.url)}{c.computed && <span className="calc">Calculated for your amount and term</span>}</>
                              : c.state === "not_confirmed" ? <span className="nc" title="The catalog has this term, but it isn’t confirmed yet">Not confirmed</span>
                              : <span className="na">Not in the sources</span>}
                          </div>
                        );
                      })}
                    </Fragment>
                  );
                })}
              </Fragment>
            ))}
          </div>
        </div>
        {rec && <Why rec={rec} />}
        {notes.length > 0 && <div className="gc-note">{notes.join(" ")}</div>}
      </div>
    </div>
  );
}
