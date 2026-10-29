# Shared: Answer schema and rendering

Applies to both tracks. Every answer, for any prompt or edge case, uses one envelope holding blocks from a fixed library. Answers differ only in which blocks they contain and in what order, so the renderer never meets a shape it doesn't know. Business additions are in `docs/business/schema-and-pipeline.md`.

## The envelope

```ts
type Answer = {
  id: string;
  locale: string;                  // language the customer wrote in: labels + number format
  pattern: PatternId | "freeform"; // one of the 11 answer patterns, or none
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
| `inputs` | sliders[]: key, min, max, step, value, unit | Live sliders on inputs already known |
| `inputs_request` | pattern, round, fields[]: key, label, question, hint?, kind (amount, months, percent, choice, options), unit?, min?, max?, options[]? | Asking for missing **required** inputs before an answer: at most 3 fields, at most 2 rounds, never optional inputs. Comes with a `skip_inputs` action. Shape: `inputFieldSchema` in `lib/agent/inputs.ts` |
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
| `evidenceUpload` | accepts (secci, esis), extracted?: CompetitorOffer, confirmed | Asking for and confirming a competitor's offer document |
| `counterOffer` | baseline, offer: levers[], rate, monthly, total, dae, conditions[], validUntil, competitorTotal; or escalation: level, status | A counter-offer inside the band, or the status of an escalated review |

## Why it always renders

- **The LLM never builds blocks.** A deterministic composer in code turns tool results into blocks; the LLM writes only `text` and picks the `pattern`. Shapes are guaranteed and numbers can't drift between text and components.
- **Every block is validated** (Zod) before rendering. An invalid or unknown block becomes a `callout` ("this part couldn't be shown") and is logged; the rest of the answer still renders.
- **Two fallbacks cover the unexpected**: `keyFacts` for structured information, plain `text` for everything else. A question no pattern anticipated still renders cleanly.
- **Edge cases are fields, not new schemas**: distress sets `mode: "hardship"` and `suppressOffers`; stale competitor data fills `staleData` and marks rows `partial`; an over-age car sets `eligible: false` with a reason; a scam report puts a danger `callout` and a freeze-card `action` first.
- **Tool data is language-neutral**: keys and numbers only (`route: "personal_loan"`, `mainRisk: "variable_rate"`); components translate and format them.
- **Same data, same render**: identical envelopes always produce identical screens. Variety comes from which blocks an answer contains.

## Signature components

Each block renders as one signature component. The visual reference is `DESIGN.md` plus the HTML prototypes, with `chat.html` for answer cards, sources and the context panel.

| Component | Block | Specification |
| --- | --- | --- |
| Financing route cards (hero) | `routes` | Cards side by side, as many as the answer scope calls for (at least three for a `solution`, for example savings, personal loan, car loan and leasing). Each shows monthly cost, total cost, time to goal and a commission badge: "No commissions" (ink on the `#FFF3C4` tint, never green, per `DESIGN.md`) only when `hasNoCommissions` is true, otherwise "3 commissions" that expands into the list. The best fit gets the accent highlight (`#FFF3C4` tint with the yellow halo, per `DESIGN.md`) with a one-line "why" underneath. Ineligible routes stay visible, greyed, with the reason |
| Live sliders | `inputs` | Amount, term and down payment under the cards; every card, the gauge and the cost bar recalculate instantly through Convex reactivity. Slider values are written to conversation state |
| Affordability gauge | `affordability` | Semicircle meter of indicative DTI against the BNR cap, a ghost needle for the rate-stress scenario, buffer left per month, labeled indicative |
| True cost breakdown | `costBreakdown` | Stacked bar or waterfall: price, interest, commissions, insurance, taxes, maintenance, fuel; estimates marked; the monthly total as the headline number |
| Goal timeline | `timeline` | Path from today to the goal date with milestones, one lane per saving route showing how fast each reaches the goal |
| Honest comparison strip | `comparison` | Raiffeisen first, competitors below, the same metrics for everyone, small "wins here" tags per metric, and a counter-offer button whenever a competitor is cheaper |

Supporting components: `debtMap` (debt list with rate and payoff bars), `keyFacts` (label and value rows), `checklist`, `callout` (colored by severity), `ticket` and `handoff` (status cards).

**Answer cards from the model (implemented now).** Until the catalog and calculators feed the composer, the answer model fills five card blocks as JSON through a `show_cards` tool: `comparison` (named options, fact rows, optional recommendation), `routes` (2 to 4 routes, one recommended with reasons and when another fits better), `keyFacts`, `checklist` and `handoff`. Schema and checks: `lib/agent/blocks.ts`. Every number on a card must be copied from one search result, named by its URL in `source`, or be the customer's own figure; anything else is dropped from the card before it is shown, and a card left empty is dropped. The model never calculates. Cards travel only with an answer that passed the text checks; their sources join the answer's source chips. The live chat renders them in `web/components/agent/AnswerCards.tsx` with the demo card classes (`.gcard`, `.cmp`, `.opts`/`.opt`, `.rec-badge`, `.rec-why`, `.kv`, `.ck`, `.handoff`). A sixth card, `simulation`, takes one cited loan interest rate (never the APR), the product and its source. The chat computes the monthly payment, total repaid and interest with the annuity formula as the customer moves the amount and term; it starts from the customer's own amount and term, or from a labelled example. When the source gives a rate range, the card shows payments at both ends, never one end alone, and `rateFor` says when the rates belong to a different product than the one asked about. With the customer's own income (and other monthly payments), it shows the payment as a share of income; a maximum debt ratio appears only when a cited result states it, framed as the published limit, never as an eligibility verdict. Income and obligations stay in the card and never in traces or memory. **Server fallback:** when the model answers without calling `show_cards`, `lib/agent/cardFallback.ts` guesses one card from the checked answer: a `checklist` when the customer asks for documents or steps and the answer has a cited list; a `simulation` for loan patterns with a cited interest rate; or `keyFacts` (titled "Savings options" for pattern 5) for patterns 5, 6, 7 and 12 from two or more bold-labelled list items with cited figures. The fallback never invents a recommendation, so it never makes a `routes` card. A list item that a card shows (matched by its name or bold label) is left out of the answer text, so nothing appears twice. The guess passes the same `checkCards` grounding, so an unsupported guess shows no card.

**Reply actions.** Besides follow-ups, two actions carry a structured reply back to the server with their text: `choose` (`inquiry`) picks one of the patterns Raiffy offered when it couldn't tell them apart, and `skip_inputs` answers without the missing inputs, using typical examples labelled as examples and no recommendation. A submitted `inputs_request` sends its values the same way. The server accepts a choice only if it was offered on the previous turn, and values only for the fields it asked, within their ranges.

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
| 11. Negotiation and counter-offer | evidenceUpload (until confirmed), comparison, counterOffer, affordability, callout (escalation status) |
| 12. List and overview | text with a bullet list (up to 8 items); checklist for documents or steps |
| Hardship or crisis mode | callout, checklist, handoff (no product blocks) |
| Missing required inputs (any pattern) | inputs_request only; the pattern's blocks follow once the inputs are known |
| Freeform | keyFacts or text only |

## Premium details

- **Source chips** under every number ("BNR · 27 Oct 2026"), built from `sources[]`; tapping one opens the document.
- **Streaming build-up**: see the thinking panel and word-by-word delivery in `docs/shared/pipeline.md`, step 6. Respect `prefers-reduced-motion` by fading instead of moving.
- **Glow consistency**: the `DESIGN.md` palette everywhere. The yellow highlight appears only on the best-fit route, so it means something. Warnings and counter-offers follow `DESIGN.md`, and if it doesn't cover a case, ask before adding a color.
- **Next steps as buttons** from `actions[]`: "Book an adviser", "Compare with BT", "What if I put 20% down?". A what-if button changes `inputs` and re-runs the composer instead of sending a typed message.
- **Auto-language with a manual toggle** (deferred: the POC is English only, with no toggle): the screen follows the customer's language; the RO/EN toggle in the header switches the same answer live.
- **Voice input** for one demo moment: the spoken question appears as text, then the cards build.

Palette and fonts: see `DESIGN.md`. The accent is yellow `#FFD23F` with amber `#FF9A3D`, used as light. Ink is `#1A1A1A`. Fonts are Geist, with Geist Mono for numbers.

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

Deferred. The POC is English only, in the interface and in answers. The rules below apply when multi-language support is added.

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
3. Move the down-payment slider: every card recalculates and the affordability gauge moves out of the warning zone.
4. The true cost bar reveals that running costs nearly match the loan payment.
5. The comparison strip shows Banca Transilvania winning on one metric; Raiffy says so and offers a counter-offer.
6. Tap the language toggle: the same answer switches to English.
7. Close on "Book an adviser".

This one flow shows the answer patterns, the financing-route rule, commission transparency, the honest pro-Raiffeisen comparison and the polish.
