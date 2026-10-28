# Shared: Answer schema and rendering

Applies to both tracks. Every answer, for any prompt or edge case, uses one envelope holding blocks from a fixed library. Answers differ only in which blocks they contain and in what order, so the renderer never meets a shape it doesn't know. Business additions are in `docs/business/schema-and-pipeline.md`.

## The envelope

```ts
type Answer = {
  id: string;
  locale: string;                  // language the customer wrote in: labels + number format
  pattern: PatternId | "freeform"; // one of the 10 answer patterns, or none
  mode: "normal" | "hardship" | "crisis" | "fraud" | "degraded";
  text: string;                    // the LLM's 2–3 framing sentences: the only free text
  blocks: Block[];                 // what the screen shows, in order
  sources: Source[];               // { id, label, publisher, date, url }
  actions: Action[];               // { kind, labelKey, payload }: apply, adviser, human, freeze card, what-if
  flags: {
    aiDisclosure: true;
    suppressOffers: boolean;       // hardship and crisis: no product blocks at all
    staleData: string[];           // sources that couldn't be confirmed
    indicativeOnly: boolean;
  };
};
```

Every block shares a base: `{ type, id, status: "ok" | "partial" | "unavailable", noteKey?, sourceIds[] }`. Missing, stale or ineligible data becomes a block state, never a broken screen.

## The block library

| Block | Key fields | Used for |
| --- | --- | --- |
| `routes` | `routes[]`: route, monthly, total, dae, timeToGoal, mainRisk, commissions[], hasNoCommissions, eligible, ineligibleReason, isBestFit, whyBestFit | Financing route cards, the hero component |
| `inputs` | sliders[]: key, min, max, step, value, unit; questions[] for missing details | Live sliders and clarifying questions |
| `affordability` | dti, cap, stressedDti, monthlyBuffer, incomeBasis | Affordability gauge |
| `costBreakdown` | items[]: label, monthly or amount, kind (loan, interest, commission, insurance, tax, running), isEstimate; total | True cost of ownership, fees explained |
| `timeline` | start, goalDate, milestones[], routes[]: route, reachDate | Saving goals, life-event steps |
| `comparison` | rows[]: bank, isRaiffeisen, metrics{}, commissions, wins[]; counterOffer? | Honest comparison strip |
| `debtMap` | debts[]: lender, balance, rate, monthly, remainingTerm | Refinancing and consolidation |
| `keyFacts` | items[]: label, value, sourceId | Generic facts: a fee, a term, a definition |
| `checklist` | items[]: textKey or text | Safety tips, documents needed |
| `callout` | severity (info, warning, danger, crisis), titleKey, body, actions[] | Scam alerts, helplines, stale-data notes |
| `ticket` | reference, responseBy, escalation[] | Complaints with CSALB and ANPC options |
| `handoff` | status, waitMinutes, callbackSlot | Human handoff |

## Why it always renders

- **The LLM never builds blocks.** A deterministic composer in code turns tool results into blocks; the LLM writes only `text` and picks the `pattern`. Shapes are guaranteed and numbers can't drift between text and components.
- **Every block is validated** (Zod) before rendering. An invalid or unknown block becomes a `callout` ("this part couldn't be shown") and is logged; the rest of the answer still renders.
- **Two fallbacks cover the unexpected**: `keyFacts` for structured information, plain `text` for everything else. A question no pattern anticipated still renders cleanly.
- **Edge cases are fields, not new schemas**: distress sets `mode: "hardship"` and `suppressOffers`; stale competitor data fills `staleData` and marks rows `partial`; an over-age car sets `eligible: false` with a reason; a scam report puts a danger `callout` and a freeze-card `action` first.
- **Tool data is language-neutral**: keys and numbers only (`route: "personal_loan"`, `mainRisk: "variable_rate"`); components translate and format them.
- **Same data, same render**: identical envelopes always produce identical screens. Variety comes from which blocks an answer contains.

## Signature components

Each block renders as one signature component. The visual reference is the BMW X5 answer-screen mockup (export it from the design canvas into `docs/ui/`).

| Component | Block | Specification |
| --- | --- | --- |
| Financing route cards (hero) | `routes` | Three or four cards side by side: savings, personal loan, car loan, leasing. Each shows monthly cost, total cost, time to goal and a commission badge: "No commissions" in green only when `hasNoCommissions` is true, otherwise "3 commissions" that expands into the list. The best fit glows cyan with a one-line "why" underneath. Ineligible routes stay visible, greyed, with the reason |
| Live sliders | `inputs` | Amount, term and down payment under the cards; every card, the gauge and the cost bar recalculate instantly through Convex reactivity. Slider values are written to conversation state |
| Affordability gauge | `affordability` | Semicircle meter of indicative DTI against the BNR cap, a ghost needle for the rate-stress scenario, buffer left per month, labeled indicative |
| True cost breakdown | `costBreakdown` | Stacked bar or waterfall: price, interest, commissions, insurance, taxes, maintenance, fuel; estimates marked; the monthly total as the headline number |
| Goal timeline | `timeline` | Path from today to the goal date with milestones, one lane per saving route showing how fast each reaches the goal |
| Honest comparison strip | `comparison` | Raiffeisen first, competitors below, the same metrics for everyone, small "wins here" tags per metric, and a counter-offer button whenever a competitor is cheaper |

Supporting components: `debtMap` (debt list with rate and payoff bars), `keyFacts` (label and value rows), `checklist`, `callout` (colored by severity), `ticket` and `handoff` (status cards).

## Block recipes per answer pattern (individuals)

The composer uses these default orders; blocks with no data are left out.

| Pattern | Blocks, in order |
| --- | --- |
| 1. Purchase goal | inputs, routes, affordability, costBreakdown, comparison, checklist |
| 2. Product comparison | comparison, routes, keyFacts |
| 3. Affordability check | affordability, inputs, routes |
| 4. Debt and refinancing | debtMap, routes, costBreakdown |
| 5. Saving and goals | timeline, inputs, routes |
| 6. Explain a term | keyFacts, costBreakdown |
| 7. Fees and statements | keyFacts, costBreakdown, routes (ways to avoid the fee), ticket |
| 8. Life event | checklist, routes, timeline |
| 9. Cash shortfall | routes, affordability, callout |
| 10. Problem or complaint | callout, ticket, handoff |
| Hardship or crisis mode | callout, checklist, handoff (no product blocks) |
| Freeform | keyFacts or text only |

## Premium details

- **Source chips** under every number ("BNR · 27 Oct 2026"), built from `sources[]`; tapping one opens the document.
- **Streaming build-up**: see the thinking panel and line-by-line delivery in `docs/shared/pipeline.md`, step 6. Respect `prefers-reduced-motion` by fading instead of moving.
- **Glow consistency**: the hero's navy, cyan and orange palette everywhere; the cyan glow appears only on the best-fit route, so the highlight means something; orange is reserved for warnings and counter-offers.
- **Next steps as buttons** from `actions[]`: "Book an adviser", "Compare with BT", "What if I put 20% down?". A what-if button changes `inputs` and re-runs the composer instead of sending a typed message.
- **Auto-language with a manual toggle**: the screen follows the customer's language; the RO/EN toggle in the header switches the same answer live.
- **Voice input** for one demo moment: the spoken question appears as text, then the cards build.

Palette from the mockup: navy `#06101D`, cyan `#3FD3F2` (recommended option only), orange `#FF9A4D` (warnings and counter-offers). Fonts: Sora (headings), IBM Plex Sans (body), IBM Plex Mono (numbers).

## Render variants

One canonical design per block type. Variants exist only where they serve the customer:

| Variant | When |
| --- | --- |
| Full vs compact | First answer in a topic vs a follow-up deeper in the conversation |
| Desktop vs mobile | Cards side by side vs a swipeable row; tables scroll in a box |
| States | Loading skeleton, partial, unavailable, ineligible, stale |
| Modes | Hardship and crisis: calm styling, no glow, no product blocks |
| Right-to-left | `dir="rtl"` for Arabic and Hebrew |

No random or decorative variants: customers learn where the monthly cost and the commissions badge sit, comparisons must look consistent, and every variant multiplies testing. To explore alternatives, design two or three versions of a block, A/B test them, and keep the winner as canonical.

## Any language

- Labels come from a master set in Romanian and English; any other language is translated once by the LLM with a glossary of terms that never change (DAE, IRCC, ROBOR, BNR, product names), cached in a Convex `translations` table, and invalidated when the master labels change.
- Numbers and dates use `Intl.NumberFormat(locale)` and `Intl.DateTimeFormat(locale)`.
- Official documents stay in their original language, noting the Romanian version is binding.
- If translation fails, labels fall back to Romanian while `text` stays in the customer's language.

## Build stack

| Layer | Choice |
| --- | --- |
| Schemas | TypeScript types plus Zod validators for `Answer` and every block, shared by backend and frontend |
| Tools | Return typed, language-neutral JSON (`routes[]`, `commissions[]`, `dti`, `tco[]`, `sources[]`) |
| Composer | Code in Convex that turns tool results into blocks following the pattern recipes |
| Streaming | Vercel AI SDK: `text` streams, each block streams as a UI component (generative UI) |
| Rendering | One React component per block type, picked by `block.type` from a registry; unknown types fall back to `callout` |
| Charts | Recharts or Visx for the gauge, cost bar and timeline |
| Motion | Framer Motion for cards animating in, disabled under `prefers-reduced-motion` |
| Live updates | Convex reactive queries recalculate blocks when sliders move |
| i18n | Translation files plus the LLM-translated, cached locales; `Intl` formatting |

Evals: render every pattern's recipe with full, partial, empty and invalid data in five or six languages; the screen must never crash, and missing data must show as a block state.

## The 90-second demo

1. The customer asks by voice: "Vreau să-mi cumpăr un BMW X5 din 2016." Text streams, then the route cards build in.
2. Leasing appears greyed out (car too old); the personal loan glows as the best fit; the car loan shows its hidden CASCO cost.
3. Move the down-payment slider: every card recalculates and the affordability gauge goes from orange to cyan.
4. The true cost bar reveals that running costs nearly match the loan payment.
5. The comparison strip shows Banca Transilvania winning on one metric; Raiffy says so and offers a counter-offer.
6. Tap the language toggle: the same answer switches to English.
7. Close on "Book an adviser".

This one flow shows the answer patterns, the financing-route rule, commission transparency, the honest pro-Raiffeisen comparison and the polish.
