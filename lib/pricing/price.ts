import { addMonths, repaymentSchedule } from "../calc/schedule";
import {
  type ClientProfile, clientProfileSchema, type CompetitorOffer, competitorOfferSchema, type Condition, type CounterOfferBand,
  counterOfferBandSchema, type Negotiation, negotiationSchema, type PersonalOffer, personalOfferSchema, type PriceLine, type PricingRule,
  pricingRuleSchema, type Quote, quoteSchema,
} from "./schemas";

/*
 * The pricing tool, pure. Every price comes from here, never from the model: list and conditional prices with the
 * cost of each condition inside total cost and DAE, then total cost first against a competitor, then the smallest
 * counter-offer inside the band, or escalation to the lowest level that can approve the gap.
 */

type Cost = { rateBps: number; upfrontFee: number; monthlyFee: number };

/** Total payable and DAE of one set of terms at the customer's amount and term. */
export function costLine(amount: number, months: number, today: string, cost: Cost) {
  const s = repaymentSchedule({ principal: amount, months, annualRateBps: Math.max(0, cost.rateBps), upfrontFee: cost.upfrontFee, monthlyFee: cost.monthlyFee,
    firstPaymentDate: addMonths(today, 1) });
  return { monthly: s.monthly, totalPayable: s.totals.payable, daeBps: Math.round(s.dae * 10_000) };
}

/** Conditions the customer can choose to meet; the others (risk band, amount) just apply or don't. */
const ACTIONABLE = new Set<Condition["kind"]>(["salaryDomiciled", "depositsAtLeast", "holdsProduct"]);

export function meets(c: Condition, p: ClientProfile, amount: number): boolean {
  switch (c.kind) {
    case "salaryDomiciled": return p.salaryDomiciled;
    case "depositsAtLeast": return p.deposits >= c.amount;
    case "holdsProduct": return p.products.includes(c.productId);
    case "riskBand": return p.riskBand !== undefined && c.in.includes(p.riskBand);
    case "amountAtLeast": return amount >= c.amount;
  }
}

type Adjustment = PricingRule["adjustments"][number];

function line(rule: PricingRule, amount: number, months: number, today: string, id: string, label: string, adjustments: Adjustment[], qualifies: boolean): PriceLine {
  const required = adjustments.flatMap((a) => a.requires);
  const cost = {
    rateBps: rule.baseRateBps + adjustments.reduce((s, a) => s + a.deltaBps, 0),
    upfrontFee: rule.fees.upfront,
    monthlyFee: rule.fees.monthly + required.reduce((s, r) => s + r.monthlyCost, 0),
  };
  return { id, label, ...cost, ...costLine(amount, months, today, cost), conditions: adjustments.filter((a) => ACTIONABLE.has(a.condition.kind)).map((a) => a.id),
    qualifies, requiredProducts: required.map((r) => ({ label: r.label, monthlyCost: r.monthlyCost })) };
}

export function quote(input: {
  rule: PricingRule; profile: ClientProfile | null; amount: number; months: number; today: string; offers?: readonly PersonalOffer[];
}): Quote {
  const rule = pricingRuleSchema.parse(input.rule);
  const { amount, months, today } = input;
  const profile = input.profile ? clientProfileSchema.parse(input.profile) : null;
  const met = (a: Adjustment) => profile !== null && meets(a.condition, profile, amount);
  // Risk and amount adjustments apply to every line; the actionable ones are the conditions on the card
  const fixed = rule.adjustments.filter((a) => !ACTIONABLE.has(a.condition.kind) && met(a));
  const actionable = rule.adjustments.filter((a) => ACTIONABLE.has(a.condition.kind));
  const unconditional = line(rule, amount, months, today, "unconditional", "Without conditions", fixed, true);
  const conditional = actionable.map((a) => line(rule, amount, months, today, a.id, a.label, [...fixed, a], met(a)))
    .sort((x, y) => x.totalPayable - y.totalPayable);
  const metActionable = actionable.filter(met);
  let current = metActionable.length ? line(rule, amount, months, today, "current", "Your price", [...fixed, ...metActionable], true) : unconditional;

  const offers = (input.offers ?? []).map((o) => personalOfferSchema.parse(o)).filter((o) => o.productId === rule.productId)
    .sort((a, b) => b.validUntil.localeCompare(a.validUntil));
  const valid = offers.find((o) => o.validUntil >= today);
  const expired = valid ? undefined : offers.find((o) => o.validUntil < today);
  if (valid) {
    const cost = { rateBps: valid.rateBps, upfrontFee: valid.upfrontFee, monthlyFee: valid.monthlyFee };
    const offerLine: PriceLine = { id: `offer:${valid.id}`, label: valid.origin === "specialist" ? "Offer from a specialist" : "Counter-offer", ...cost,
      ...costLine(amount, months, today, cost), conditions: valid.conditions, qualifies: true, requiredProducts: [] };
    if (offerLine.totalPayable < current.totalPayable) current = offerLine;
  }
  return quoteSchema.parse({
    productId: rule.productId, product: rule.product, amount, months, unconditional, conditional, current,
    ...(valid ? { personalOffer: valid } : {}), ...(expired ? { expiredOffer: expired } : {}),
    couldBeBetter: profile === null || profile.unknown.length > 0, ruleVersion: rule.version,
  });
}

/** A competitor's offer recalculated at the customer's amount and term, so both sides compare like for like. */
export function competitorAt(raw: CompetitorOffer, amount: number, months: number, today: string) {
  const c = competitorOfferSchema.parse(raw);
  return { ...c, amount, months, ...costLine(amount, months, today, { rateBps: c.rateBps, upfrontFee: c.upfrontFee, monthlyFee: c.monthlyFee + c.requiredMonthly }) };
}

const bandFits = (b: CounterOfferBand, p: ClientProfile, amount: number) =>
  (!b.segment.riskBand || (p.riskBand !== undefined && b.segment.riskBand.includes(p.riskBand)))
  && (b.segment.salaryDomiciled === undefined || b.segment.salaryDomiciled === p.salaryDomiciled)
  && (!b.segment.amountRange || (amount >= b.segment.amountRange[0] && amount <= b.segment.amountRange[1]));

const STEP_BPS = 5;

export function negotiate(input: {
  rule: PricingRule; bands: readonly CounterOfferBand[]; profile: ClientProfile | null; competitor: CompetitorOffer;
  amount: number; months: number; today: string; offers?: readonly PersonalOffer[];
}): Negotiation {
  const { amount, months, today } = input;
  const rule = pricingRuleSchema.parse(input.rule);
  const profile = input.profile ? clientProfileSchema.parse(input.profile) : null;
  const q = quote({ rule, profile, amount, months, today, offers: input.offers });
  const theirs = competitorAt(input.competitor, amount, months, today);
  const ours = q.current;
  const gap = ours.totalPayable - theirs.totalPayable;
  const segment = profile ? `${profile.riskBand ?? "no_risk_view"}:${profile.salaryDomiciled ? "salary" : "no_salary"}` : "unknown";
  const out = (resolution: Negotiation["resolution"], internal: Partial<Negotiation["internal"]>, offer?: Negotiation["offer"]) => negotiationSchema.parse({
    resolution, quote: q, competitor: theirs, gap, ...(offer ? { offer } : {}),
    internal: { bandId: null, level: null, neededCutBps: null, segment, ...internal },
  });

  // Total cost first: many "cheaper" offers cost more once every fee is in
  if (gap <= 0) return out("not_needed", {});
  // A typed claim alone never earns a counter-offer
  if (theirs.source === "client_claim") return out("evidence_needed", {});
  // Indicative affordability before any offer that could lead to borrowing
  if (profile?.monthlyIncome && (profile.obligations + ours.monthly) * 10_000 > profile.monthlyIncome * rule.maxDebtRatioBps) return out("affordability", {});

  const bands = input.bands.map((b) => counterOfferBandSchema.parse(b)).filter((b) => b.productId === rule.productId);
  const band = profile?.riskBand ? bands.find((b) => bandFits(b, profile, amount)) : undefined;
  const escalation = band?.escalation ?? bands[0]?.escalation ?? [{ level: "specialist" as const }];
  const beats = (cost: Cost) => costLine(amount, months, today, cost).totalPayable <= theirs.totalPayable;
  const base: Cost = { rateBps: ours.rateBps, upfrontFee: ours.upfrontFee, monthlyFee: ours.monthlyFee };

  // Smallest cut, after the band's fee waivers, that matches their total: the gap a reviewer is asked to approve
  const neededCut = (start: Cost): number | null => {
    for (let cut = STEP_BPS; cut <= start.rateBps; cut += STEP_BPS) if (beats({ ...start, rateBps: start.rateBps - cut })) return cut;
    return null;
  };
  const escalate = (from: Cost, bandId: string | null) => {
    const cut = beats(from) ? 0 : neededCut(from);
    const level = cut === null ? escalation.at(-1)!.level : (escalation.find((e) => e.upToDeltaBps === undefined || cut <= e.upToDeltaBps) ?? escalation.at(-1)!).level;
    return out("escalate", { bandId, level, neededCutBps: cut });
  };
  // Only known clients (a risk view from account data) get an automatic counter-offer
  if (!band) return escalate(base, null);

  const levers: NonNullable<Negotiation["offer"]>["levers"] = [];
  let cost = { ...base };
  const done = () => out("band", { bandId: band.id }, {
    levers, validUntil: addDays(today, band.validityDays),
    line: { id: "counter", label: "Counter-offer", ...cost, ...costLine(amount, months, today, cost), conditions: ours.conditions, qualifies: true, requiredProducts: ours.requiredProducts },
  });
  // Fee waivers first, then the smallest margin cut
  if (band.levers.some((x) => x.kind === "feeWaiver") && cost.upfrontFee > 0) {
    levers.push({ kind: "feeWaiver", label: `${rule.fees.upfrontLabel} waived`, amount: cost.upfrontFee });
    cost = { ...cost, upfrontFee: 0 };
    if (beats(cost)) return done();
  }
  const cut = band.levers.find((x) => x.kind === "marginCut");
  if (cut?.kind === "marginCut") {
    for (let d = STEP_BPS; d <= cut.maxDeltaBps; d += STEP_BPS) {
      if (beats({ ...cost, rateBps: cost.rateBps - d })) {
        levers.push({ kind: "marginCut", label: `Rate lowered by ${(d / 100).toFixed(2)} pp`, deltaBps: -d });
        cost = { ...cost, rateBps: cost.rateBps - d };
        return done();
      }
    }
  }
  return escalate(cost, band.id);
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
