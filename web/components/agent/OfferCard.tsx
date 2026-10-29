"use client";

import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { BadgePercentIcon, CheckIcon, UserCheckIcon } from "lucide-react";
import { lei } from "@/lib/format";
import { pricingApi, type LogId, type OfferBlock, type PriceLine, type UiBlock } from "@/lib/agent-api";
import { CardHead, Lead } from "./AnswerCards";

/*
 * The price card (chat.html's offerHTML, docs/shared/pricing.md): conditional prices next to the unconditional one
 * with equal weight, total cost against the competitor at the same amount and term, and a counter-offer as the one
 * lead figure. Built by code from the pricing tool, never by the model. Sample pricing in the preview: the head, the
 * pills and the note say so. Accepting is simulated; a review needs the customer's tap.
 */

export const isOffer = (b: UiBlock): b is OfferBlock => b.type === "offer";

const b = (bani: number) => lei(bani / 100);
const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;
const short = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

const TITLE: Record<OfferBlock["resolution"], string> = {
  quote: "Your price", band: "Counter-offer", not_needed: "Total cost compared", escalate: "A specialist can review this",
  evidence_needed: "Compared with published figures", affordability: "Above the affordability limit",
};

function Row({ line, current }: { line: PriceLine; current: boolean }) {
  const detail = line.requiredProducts.length
    ? `Includes ${line.requiredProducts.map(r => `${r.label.toLowerCase()}, ${b(r.monthlyCost)}/month`).join(", ")}`
    : `${b(line.monthly)} a month`;
  return (
    <div className={current ? "price-row cur" : "price-row"}>
      <span className="nm">{line.label}{line.qualifies && line.id !== "unconditional" && <span className="pill">You already qualify</span>}
        <span className="dsc">{detail} · DAE {pct(line.daeBps)}</span></span>
      <span className="rt">{pct(line.rateBps)}</span>
      <span className="tt">{b(line.totalPayable)}</span>
    </div>
  );
}

export function OfferCard({ block, cite, latest }: { block: OfferBlock; cite?: (url: string) => ReactNode; latest: boolean }) {
  const { quote: q, competitor: c, offer: o } = block;
  const logId = block.logId as LogId | undefined;
  const status = useQuery(pricingApi.myNegotiations, logId ? { logIds: [logId] } : "skip")?.[0];
  const requestReview = useMutation(pricingApi.requestReview);
  const setOutcome = useMutation(pricingApi.setOutcome);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (run: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await run(); } catch { setError("That didn't go through. Try again."); } finally { setBusy(false); }
  };

  const ours = o?.line ?? q.current;
  const approved = status?.approvedOffer;
  const statusText = !status ? null
    : status.outcome === "accepted" ? "Accepted (simulated). In the app this would open the official application, where nothing is final until you sign."
    : status.outcome === "declined" ? "Noted. You chose not to take this offer."
    : status.outcome === "expired" ? "This offer has expired. Ask again for today's price."
    : status.review === "requested" ? "Sent for review. A specialist will reply in this chat; nothing changes until they do."
    : status.review === "declined" ? "The specialist couldn't improve the price this time."
    : null;

  return (
    <div className="gcard offer-card">
      <CardHead icon={BadgePercentIcon} title={`${TITLE[block.resolution]} · ${q.product.replace(/ \(sample pricing\)$/, "")}`}
        sub={`${b(q.amount)} over ${q.months} months`} meta="Sample pricing" />
      <div className="gc-b ac-b">
        {o
          ? <Lead label="Total to repay with the counter-offer" note={`Valid until ${short(o.validUntil)} · indicative until the bank issues it`}>{b(o.line.totalPayable)}{cite?.(block.sourceUrl)}</Lead>
          : <Lead label="Your total to repay" note={`${pct(q.current.rateBps)} fixed · ${b(q.current.monthly)} a month`}>{b(q.current.totalPayable)}{cite?.(block.sourceUrl)}</Lead>}

        <div className="prices">
          <Row line={q.unconditional} current={q.current.id === "unconditional"} />
          {q.conditional.map(l => <Row key={l.id} line={l} current={false} />)}
          {q.current.id.startsWith("offer:") && <Row line={q.current} current />}
        </div>

        {c && (
          <div className="vs" role="table" aria-label="Total cost at the same amount and term">
            <div role="row" style={{ display: "contents" }}>
              <span className="h" role="columnheader">Same terms</span>
              <span className="h" role="columnheader">Raiffeisen{o && <span className="wide-only"> (counter-offer)</span>}</span>
              <span className="h" role="columnheader">{c.bank.replace(/ \(sample\)$/, "")}{block.competitorUrl && cite?.(block.competitorUrl)}</span>
            </div>
            {([["Rate", (x: { rateBps: number }) => pct(x.rateBps)], ["Upfront fee", (x: { upfrontFee: number }) => b(x.upfrontFee)],
              ["DAE", (x: { daeBps: number }) => pct(x.daeBps)], ["Total to repay", (x: { totalPayable: number }) => b(x.totalPayable)]] as const).map(([label, f]) => (
              <div role="row" key={label} style={{ display: "contents" }}>
                <span role="cell">{label}</span><span className="v" role="cell">{f(ours)}</span><span className="v" role="cell">{f(c)}</span>
              </div>
            ))}
          </div>
        )}

        {o && (
          <div className="why">
            {o.levers.map(l => (
              <div className="why-row tip" key={l.label}><BadgePercentIcon aria-hidden="true" />
                <span><b className="why-k">What changed:</b> {l.label.toLowerCase()}{l.amount ? `, ${b(l.amount)} less` : ""}.</span></div>
            ))}
          </div>
        )}
        {approved && (
          <div className="why"><div className="why-row tip"><UserCheckIcon aria-hidden="true" />
            <span><b className="why-k">Specialist offer{approved.approvedBy ? ` from ${approved.approvedBy}` : ""}:</b> {pct(approved.rateBps)}, {b(approved.totalPayable)} in total, valid until {short(approved.validUntil)}. Ask again to see it in your price.</span></div></div>
        )}

        <div className="src-pills">
          <span className="pill">Sample pricing</span>
          {c && <span className="pill">{c.bank.replace(/ \(sample\)$/, "")} · {c.sourceLabel.toLowerCase()}</span>}
          {o && <span className="pill">Counter-offer · valid until {short(o.validUntil)}</span>}
          {q.personalOffer?.issuedBy && <span className="pill">Offer from {q.personalOffer.issuedBy.name} · valid until {short(q.personalOffer.validUntil)}</span>}
        </div>

        {statusText ? <p className="offer-status" role="status">{statusText}</p> : logId && latest && (
          <div className="offer-acts">
            {o && status?.outcome === "pending" && <>
              <button type="button" className="btn btn-dark btn-sm" disabled={busy} onClick={() => act(() => setOutcome({ logId, outcome: "accepted" }))}><CheckIcon aria-hidden="true" />Accept (simulated)</button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(() => setOutcome({ logId, outcome: "declined", reasonLost: "other" }))}>Not now</button>
            </>}
            {(block.resolution === "escalate" || block.resolution === "evidence_needed") && !status?.review &&
              <button type="button" className="btn btn-dark btn-sm" disabled={busy} onClick={() => act(() => requestReview({ logId }))}><UserCheckIcon aria-hidden="true" />Ask a specialist to review this</button>}
          </div>
        )}
        {error && <p className="offer-status" role="alert">{error}</p>}

        <p className="spend-note">
          Sample pricing in this preview, not a real offer. The choice is yours.
          {q.couldBeBetter && " Some of your information is switched off in “What Raiffy can see”, so your price could be better."}
          {q.expiredOffer && ` Your earlier offer expired on ${short(q.expiredOffer.validUntil)}, so this is the list price again.`}
        </p>
      </div>
    </div>
  );
}
