# Shared: Relationship pricing and counter-offers

The price depends on the whole relationship. The bank weighs what the client is worth overall: salary paid into the bank, deposits, other products, credit risk and loan size. Discounts are often conditional, for example "this margin if your salary comes to us". Mortgages, large loans and refinancing get the most room; small personal loans get little. The price can also change when the client negotiates.

Raiffy shows these prices honestly, explains the levers and, when a client negotiates, can make a counter-offer, but **only inside a band the pricing team has pre-approved**. Every price comes from the pricing tool, never from the LLM. Beyond the band, a specialist decides. The conversation flow is answer pattern 11, Negotiation and counter-offer (`docs/individuals/answer-patterns.md`).

## Pricing rules (catalog data)

A product has no single rate. It has a base price, conditional adjustments and counter-offer bands, all stored as data, edited in the console (`docs/shared/console.md` → Products) and versioned with a source, owner and review date like every other value.

```ts
type PricingRule = {
  productId: string;
  base: { kind: "margin" | "fixedRate"; value: number; index?: "IRCC" | "ROBOR" | "EURIBOR" };
  adjustments: {
    id: string;                    // "salary_domiciled"
    labelKey: string;              // "With salary transfer"
    condition: Condition;          // evaluated against the client profile
    delta: number;                 // percentage points, negative for a discount
    requires?: {                   // what the client must take or keep to get it
      productId: string;           // e.g. an account package or insurance
      costIncluded: true;          // its fees always go into total cost and DAE
    }[];
  }[];
  validFrom: string; sourceUrl: string; owner: string; reviewBy: string;
};

type Condition =
  | { kind: "salaryDomiciled" }
  | { kind: "depositsAtLeast"; amount: number }
  | { kind: "holdsProduct"; productId: string }
  | { kind: "riskBand"; in: ("A" | "B" | "C" | "D")[] }
  | { kind: "amountAtLeast"; amount: number };

// Configured by the pricing team, per product and segment
type CounterOfferBand = {
  productId: string;
  segment: { riskBand?: ("A" | "B" | "C" | "D")[]; salaryDomiciled?: boolean; amountRange?: [number, number] };
  levers: (                        // what Raiffy may offer on its own, in this order
    | { kind: "feeWaiver"; feeId: string }            // e.g. waive the 249 lei origination fee
    | { kind: "marginCut"; maxDelta: number }         // e.g. up to −0.5 pp
  )[];
  conditions?: string[];           // adjustment IDs the offer depends on ("salary_domiciled")
  escalation: {                    // who decides beyond the band
    level: "specialist" | "branchManager" | "pricingCommittee";
    upToDelta?: number;            // largest cut this level can approve; omitted = no limit
  }[];
  validityDays?: number;          // how long an automatic counter-offer stays valid; default 7
  validFrom: string; owner: string; reviewBy: string;
};
```

- Room by product type (starting point, confirmed with the bank): mortgages and refinancing get the widest bands and more escalation levels; small personal loans and overdrafts get a fee waiver at most, or no band at all.
- **Band limits are internal.** They're never shown to the customer or written into any answer.

## Client profile (what pricing reads)

```ts
type ClientProfile = {
  salaryDomiciled: boolean;
  monthlyIncome?: number;
  deposits: number;               // savings and deposits at Raiffeisen
  products: string[];             // cards, account package, insurance, existing loans
  riskBand?: "A" | "B" | "C" | "D";
  obligations: number;            // monthly debt payments, for DTI
  personalOffers: PersonalOffer[];
};

type PersonalOffer = {
  productId: string; rate: number; fees: Commission[];
  origin: "band" | "specialist";             // automatic counter-offer, or approved after escalation
  issuedBy?: { name: string; role: string }; // set for specialist offers, e.g. Ana M., credit specialist
  conditions: string[];                      // shown on the card
  validUntil: string; sourceId: string;
};
```

- Only what the customer has allowed in the context panel ("What Raiffy can see") is read. When a permission is off, the answer says the price could be better than the one shown.
- A personal offer overrides list pricing for that product until it expires, and shows its own source pill.

## Competitor evidence

A counter-offer needs something real to answer. **Raiffy asks for evidence instead of acting on a typed claim.**

| Evidence | Use |
| --- | --- |
| Competitor data from official documents (SECCI, fee information documents, ESIS) already in the store, fresh within its limit | Compare directly, with the document as the source |
| **The client uploads the competitor's SECCI** (or ESIS for a mortgage) | Extract amount, term, rate, DAE, every fee and the total amount payable into a `CompetitorOffer`. The client confirms the extracted figures before they're used. PII is masked on upload, the file is scoped to that client, and it follows chat retention. |
| A typed claim only ("BT gave me 6.9%") | Acknowledge it, compare against the competitor's published standard rates if they're in the store (labelled as published, not the client's offer), and ask for the SECCI. **No counter-offer is made on a typed claim alone.** |

```ts
type CompetitorOffer = {
  bank: string; productType: string;
  amount: number; termMonths: number; rate: number; dae: number;
  fees: Commission[]; totalPayable: number;
  source: "official_store" | "client_secci" | "client_claim";
  confirmedByClient: boolean; documentId?: string; verifiedAt: string;
};
```

## Total cost first

Before any counter-offer, Raiffy compares **total cost**: DAE and the total amount payable, with every fee, mandatory insurance and required package on both sides, for the same amount and term (comparability rules in `docs/individuals/calculations.md`).

- Many "cheaper" offers disappear at this step: a lower headline rate with a higher fee or mandatory insurance often costs more in total. When that happens, Raiffy says so plainly, shows why, and makes no counter-offer, because none is needed.
- When the competitor really is cheaper in total, Raiffy says so too, then moves to the counter-offer.

## Counter-offers

1. **Inside the band, automatic, for known clients only.** Like an advisor in a branch, Raiffy only discounts for clients the bank already has a risk view of: an existing pre-approval, or a risk band from account data. Everyone else is shown the list price, labelled "indicative, subject to assessment", and goes to step 2. For known clients, the pricing tool picks the smallest combination of the band's levers (fee waivers first, then margin cuts) that matches or beats the competitor's total cost, within `maxDelta`. Raiffy shows it as a counter-offer card, valid for 7 days unless the band sets `validityDays`. It stays indicative until the bank's systems issue the offer (`docs/shared/plan-summary-handoff.md`).
2. **Above the band, escalate.** If no combination inside the band is enough, or there's no band for this product and segment, Raiffy says "A specialist can review this", and with the client's agreement sends the case, with the competitor offer attached, to the lowest `escalation` level that can approve the gap. It never promises a price it isn't allowed to give, never says the specialist will match the offer, and never hints at the band's limits.
3. **The specialist decides** in the console (`docs/shared/console.md` → Reviews). An approved price comes back to the chat as a `PersonalOffer` with `origin: "specialist"`; a declined case comes back with the best offer Raiffy can make inside the band, if any.

## How prices are shown

| Rule | Why |
| --- | --- |
| **Conditions sit on the card itself**, next to the price they change: "7.9% with salary transfer". Never in a footnote. | Honest finance; no bait pricing |
| A conditional price always appears **next to the unconditional one**, with equal weight: "7.9% with salary transfer · 9.4% without" | The client sees what they'd get either way |
| The cost of meeting a condition (account package, insurance) is **included in the monthly and total cost and the DAE** of the discounted line | Commission transparency; a discount that costs more than it saves must look like it |
| Conditions the client already meets are marked "You already qualify" | The price shown is the one they'd actually get |
| The recommendation can be conditional: "I recommend the loan if you move your salary; without that, the overdraft costs less" | Recommendation rule (`DESIGN.md`) |
| Every adjusted price shows its source and date. A counter-offer shows "Counter-offer · valid until 12 Nov"; a specialist offer shows "Offer from Ana M. · valid until 12 Nov". | A source for every number |
| Prices stay indicative until the bank's systems issue the offer | OUG 50/2010 |

UI: a **conditional price row** (the condition label on the card, both prices side by side, the condition's cost included), a **counter-offer card** (what changed, such as "origination fee waived" or "−0.3 pp", with the competitor's total cost alongside), and the **offer source pills**. Add all three to `DESIGN.md` when they're built.

## Logging and the win-rate KPI

**Every counter-offer and its outcome is logged**, inside and above the band.

```ts
type CounterOfferLog = {
  id: string; conversationId: string; productId: string; segment: string;
  competitor: { bank: string; source: CompetitorOffer["source"]; totalPayable: number };
  ourListTotal: number;
  resolution: "not_needed" | "band" | "escalated";  // not_needed: we were already cheaper in total
  offer?: { levers: string[]; totalPayable: number; approvedBy?: string; level?: string };
  outcome: "accepted" | "declined" | "expired" | "pending";  // updated from the official application flow
  reasonLost?: "price" | "conditions" | "speed" | "other";
  createdAt: string; closedAt?: string;
};
```

- **Counter-offer win rate** = accepted / (band + escalated) counter-offers, by product, segment, competitor and resolution.
- The pricing team sees it in the console (`docs/shared/console.md` → Counter-offers), along with where the bank is losing on price: the competitors and segments with the most declines, the average gap to the competitor's total cost, and how often "cheaper" offers disappeared at the total-cost step.
- The log is pseudonymized for reporting. Customer identity is visible only from the review case, under the console's access rules.

## Mock data (seed personas)

Same request for each (8,000 lei personal loan, 12 months) so the demo shows the price moving:

| Persona | Profile | Expected outcome |
| --- | --- | --- |
| Long-time client | Salary at Raiffeisen, 20,000 lei deposits, card and account package, risk A | Lowest price; "You already qualify" on the salary discount |
| New client | Salary at another bank, no deposits, risk B | List price, with "with salary transfer" shown as a lever |
| Client with a competitor SECCI | Risk A, uploads a BT SECCI with a lower rate but a higher fee | Total cost first: BT's offer costs more in total, no counter-offer needed |
| Client with a cheaper competitor | Risk A, uploads a SECCI that's genuinely 120 lei cheaper in total | Automatic counter-offer inside the band (fee waiver) |
| Refinancing a mortgage | Existing mortgage elsewhere, salary at Raiffeisen, large amount | Above the band: escalated to a specialist, who returns a personal offer |
| Small loan | 3,000 lei, risk C, no band | Raiffy says plainly there's little room and suggests cheaper routes, like using savings |

Seed in `convex/seed/`, or inline as mock data in the HTML prototypes.

## Evals

| Check | Source |
| --- | --- |
| A conditional price never appears without the unconditional one, and its condition is on the card | How prices are shown |
| The cost of a required product is included in the discounted line's total cost and DAE | Commission transparency |
| No counter-offer is made on a typed claim alone; Raiffy asks for the SECCI | Competitor evidence |
| Extracted SECCI figures are confirmed by the client before use | Competitor evidence |
| Total cost is compared before any counter-offer; an offer that's cheaper only by headline rate gets no counter-offer and an explanation | Total cost first |
| An automatic counter-offer never goes beyond its band, and only clients with a risk view get one | Counter-offers |
| An automatic counter-offer expires after 7 days, or the band's `validityDays` | Counter-offers |
| Above the band, Raiffy escalates and never promises or hints at a price; band limits never appear in any answer | Counter-offers |
| Every counter-offer, including `not_needed`, creates a log entry, and its outcome is updated | Logging and the win-rate KPI |
| Each lever's effect matches the pricing tool to the cent | Numbers never come from the LLM |
| With a permission off, the answer says the price could be better | Client profile |
| An expired personal offer falls back to list pricing and says so | Client profile |

## Check with compliance

- How discounts tied to other products must be disclosed, especially for mortgages, where bundling and tying rules apply (OUG 52/2016).
- Whether an automatic counter-offer inside the band counts as a binding offer, and what it must say so it doesn't.
- Retention and legal basis for storing a client's uploaded competitor documents.
