import type { Citable } from "../rag/answer";
import { lei, pct } from "../rag/tools";
import type { Negotiation, PriceLine, Quote } from "./schemas";

/*
 * What the model reads from the pricing tool: outcomes only, as citable text it may quote figure by figure. Band
 * limits, the gap a reviewer is asked to approve and the approval level never appear here (pricing.md: band limits
 * are internal). Everything is sample pricing in the preview, and the text says so.
 */

export const pricingSourceUrl = (q: Quote) => `raiffy:pricing/${q.productId}/${q.ruleVersion}/${q.amount}x${q.months}`;
export const competitorSourceUrl = (id: string) => `raiffy:competitor/${id}`;

const lineText = (l: PriceLine) =>
  `${l.label}: ${pct(l.rateBps)} fixed, ${lei(l.monthly)} a month, total payable ${lei(l.totalPayable)}, DAE ${pct(l.daeBps)}`
  + (l.upfrontFee ? `, ${lei(l.upfrontFee)} upfront fee` : "")
  + (l.requiredProducts.length ? `, including ${l.requiredProducts.map((r) => `${r.label.toLowerCase()} at ${lei(r.monthlyCost)} a month`).join(" and ")}` : "")
  + (l.qualifies && l.conditions.length ? " (the customer already qualifies)" : "") + ".";

export function quoteCitable(q: Quote, note?: string): Citable {
  const lines = [
    `SAMPLE PRICING in this preview, not a real offer. Indicative, subject to the bank's assessment. ${q.product}, ${lei(q.amount)} over ${q.months} months.`,
    lineText(q.unconditional),
    ...q.conditional.map(lineText),
    `The customer's price today: ${lineText(q.current)}`,
    ...(q.personalOffer ? [`Personal offer${q.personalOffer.issuedBy ? ` from ${q.personalOffer.issuedBy.name}, ${q.personalOffer.issuedBy.role}` : ""}, valid until ${q.personalOffer.validUntil}.`] : []),
    ...(q.expiredOffer ? [`An earlier personal offer expired on ${q.expiredOffer.validUntil}; list pricing applies again.`] : []),
    ...(q.couldBeBetter ? ["Some account information is switched off in \"What Raiffy can see\", so the price could be better than shown."] : []),
    ...(note ? [note] : []),
  ];
  return { chunkId: `price:${q.productId}`, label: "Raiffeisen price (sample pricing)", url: pricingSourceUrl(q), text: lines.join("\n"),
    collectedAt: "2026-10-01T00:00:00+00:00", sectionType: "table", score: 1 };
}

export function negotiationCitables(n: Negotiation): Citable[] {
  const c = n.competitor;
  const theirs: Citable = {
    chunkId: `competitor:${c.id}`, label: `${c.bank} (${c.sourceLabel.toLowerCase()})`, url: competitorSourceUrl(c.id),
    text: [
      c.source === "client_claim" ? `${c.bank}: the customer's typed claim. Compared here with ${c.bank}'s published figures (sample), not the customer's own offer.` : `${c.bank}, ${c.product}: ${c.sourceLabel}, not a real offer from this bank.`,
      `At ${lei(c.amount)} over ${c.months} months: ${pct(c.rateBps)} fixed, ${lei(c.monthly)} a month, total payable ${lei(c.totalPayable)}, DAE ${pct(c.daeBps)}${c.upfrontFee ? `, ${lei(c.upfrontFee)} upfront fee` : ""}${c.requiredMonthly ? `, mandatory products ${lei(c.requiredMonthly)} a month` : ""}.`,
    ].join("\n"),
    collectedAt: `${c.verifiedAt}T00:00:00+00:00`, sectionType: "table", score: 1,
  };
  const diff = Math.abs(n.gap);
  const outcome: Record<Negotiation["resolution"], string> = {
    not_needed: `Total cost first: ${c.bank}'s offer costs ${lei(diff)} more in total than the customer's Raiffeisen price, despite its rate. No counter-offer is needed.`,
    band: n.offer ? `Counter-offer (sample, indicative until the bank issues it, valid until ${n.offer.validUntil}): ${n.offer.levers.map((l) => l.label).join(" and ")}. ${lineText(n.offer.line)} That is ${lei(c.totalPayable - n.offer.line.totalPayable)} less in total than ${c.bank}.` : "",
    escalate: `${c.bank}'s offer costs ${lei(diff)} less in total. Raiffy can't improve the price on its own here. A specialist can review it: the customer can ask for that with the button on the card. Don't promise, hint at or estimate any price a specialist might give.`,
    evidence_needed: `A typed claim isn't enough for a counter-offer. On published figures, ${c.bank} costs ${lei(diff)} ${n.gap > 0 ? "less" : "more"} in total. Ask the customer for the competitor's SECCI form; uploading it isn't available in this preview yet, so a specialist can look at it.`,
    affordability: "With this payment, debt payments would go above the indicative affordability limit, so no counter-offer is made. Suggest a smaller amount, a longer term or a specialist.",
  };
  const ours = quoteCitable(n.quote, `Negotiation outcome: ${outcome[n.resolution]}`);
  return [ours, theirs];
}
