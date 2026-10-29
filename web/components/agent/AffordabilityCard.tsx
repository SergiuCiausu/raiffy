"use client";

import { CalculatorIcon } from "lucide-react";
import { fmt, months } from "@/lib/format";
import type { AffordabilityBlock, UiBlock } from "@/lib/agent-api";
import { CardHead, Lead } from "./AnswerCards";

/*
 * The affordability card: built by code from the indicative debt-service check (lib/agent/affordabilityBlock.ts),
 * never by the model. It leads with the most a new monthly instalment could be under the dated limit, then what the
 * check used and what it can't see. It is never a credit decision, and it says so.
 */

export const isAffordability = (b: UiBlock): b is AffordabilityBlock => b.type === "affordability";

const day = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function AffordabilityCard({ block }: { block: AffordabilityBlock }) {
  const { inputs, limit, results } = block;
  const money = (n: number) => `${fmt(n)} ${inputs.currency === "EUR" ? "euro" : "lei"}`;
  const rate = results.fitsAtAnyAnnualRateUpToPercent;
  return (
    <div className="gcard">
      <CardHead icon={CalculatorIcon} title="Affordability check" sub={`${limit.source} · ${day(limit.validFrom)}`} meta="Indicative" />
      <div className="gc-b ac-body">
        <Lead label="Most a new monthly instalment could be" note={`${limit.maxDebtSharePercent}% of your net income, minus what you already pay`}>
          {money(results.maxNewMonthlyInstalment)}
        </Lead>
        <div className="kv-list">
          <div className="kv fact"><span>Your figures</span><b>{money(inputs.loanAmount)} over {months(inputs.termMonths)}</b></div>
          <div className="kv fact"><span>Instalment with no interest</span><b>{money(results.instalmentWithNoInterest)} a month</b></div>
          <div className="kv fact"><span>Still fits at an annual rate up to</span>
            <b>{results.fitsEvenWithNoInterest ? rate === null ? "Any rate checked" : `${rate}%` : "Doesn’t fit even with no interest"}</b></div>
          {!results.termWithinConsumerLimit && <div className="kv fact"><span>Term</span><b>Longer than the consumer-loan limit</b></div>}
        </div>
      </div>
      <div className="gc-note">Not a credit decision. The check can’t see {block.notChecked.join(", ")}.</div>
    </div>
  );
}
