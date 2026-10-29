# Shared: Operator and admin console

Every number comes from deterministic tools, so a new product is new data, not new code. Each specialist edit becomes an eval case, so the need for human review falls as volume grows. The console is where both happen: operators and admins keep the catalog, rules, knowledge and prompts current, review answers, and turn their corrections into tests.

It serves both tracks (individuals and business). Customers never see it.

## Where it lives

| Stage | Location |
| --- | --- |
| Now: HTML prototype | `console.html` at the repo root, next to `chat.html`, a self-contained file following `DESIGN.md`. Hash routes per page, mock data inline. |
| Later: Next.js | `app/(console)/console/*` (URL `/console`) in the same app as the customer UI, with its own layout. Data in `convex/catalog/`, `convex/rules/`, `convex/regulations/`, `convex/knowledge/`, `convex/prompts/`, `convex/reviews/`, `convex/evals/` and `convex/audit.ts`. Shared Zod schemas in `lib/catalog/`. Accepted eval cases exported to `evals/cases/reviews/`. |

One app, not two: the console edits the same Convex tables the chat reads, and Clerk roles already exist. It can move to its own app later (for example, bank-network-only access) without changing the data.

## Roles and approval

Roles come from Clerk `publicMetadata.role` and are checked in every Convex function, not only in the page guard.

| Action | Operator | Admin |
| --- | --- | --- |
| Review queue: confirm or edit customer answers | Yes | Yes |
| Propose a change to products, pricing rules, parameters, knowledge, prompts or regulations | Yes, goes to the approval queue | Yes, publishes directly |
| Approve or reject an operator's proposal | No | Yes |
| Accept or reject draft eval cases | No | Yes |
| Decide an escalated counter-offer, up to their approval level | Yes, at the `specialist` level | Yes, at any level |
| Users and roles (through Clerk), audit log | No | Yes |
| Hard limits (behavior rules in code) | Read-only | Read-only |

- **An operator's change needs an admin's approval** before it's published. **An admin's change is published with no further approval.**
- An admin can't approve on an operator's behalf without opening the diff; the approval records who approved, when, and an optional note.
- Every change, approval, rejection and rollback goes to the audit log.
- **Pricing rules and counter-offer bands are owned by the pricing team.** In the POC, pricing-team members use the admin role; a dedicated `pricing` role (publish pricing only, see the win-rate data) is an open decision.
- Escalated counter-offers follow the bank's approval levels (`specialist`, `branchManager`, `pricingCommittee` in `docs/shared/pricing.md`). In the POC, operators decide at the `specialist` level and admins at any level.

## Change lifecycle

```
Operator:  draft → pending approval → published | rejected (with reason)
Admin:     draft → published
Any:       published → rolled back (restores the previous version as a new version)
```

- **Everything is versioned.** Publishing creates a new version with `validFrom` (now or a scheduled date) and never edits a published version in place.
- Answers use only the version that is published and valid at answer time. Every quote stores the version IDs it used (`docs/individuals/calculations.md`).
- **Impact preview before publishing:** the console runs the calculators on a fixed set of sample cases and shows before and after ("8,000 lei · 12 months: 696 → 701 lei a month; recommendation unchanged"). For prompts, the preview is the eval run (see Prompts).
- **On publish:** re-embed changed documents and FAQs, refresh dependent caches, and mark open plan summaries that used the old version as "Figures updated since this plan".

## Pages

### Home

What needs attention: pending approvals (admin), open review requests and escalated counter-offers, values past or near `reviewBy`, failing eval runs, and recent changes.

### Products

The catalog of financial solutions, for both tracks.

- List with filters: track, product type, status (published, draft, pending, scheduled), and "needs review" (any value near or past `reviewBy`).
- Editor fields: name, type, track, description keys, rates, **every fee and commission** (origination, administration, early repayment, mandatory insurance, required packages, FX spreads, or confirmed none), amount and term limits, eligibility rules, required documents, linked documents and FAQs, and for every value its `sourceUrl`, `validFrom`, `owner` and `reviewBy`.
- **Pricing rules** (base price and conditional discounts) and **counter-offer bands** (per product and segment: the fee waivers and margin cut Raiffy may offer on its own, the conditions, and the escalation levels beyond) are edited here too. Formats are in `docs/shared/pricing.md`. Band limits are internal and the console marks them so.
- The first catalog comes from an import of Raiffeisen's real products (`scripts/import-catalog.ts`, validated by the same Zod schemas). It's handled separately.

### Rules

Two kinds, shown separately on purpose.

| Kind | Examples | In the console |
| --- | --- | --- |
| **Parameters** (dated values) | DTI cap, BNR limits, tax thresholds, the overdraft limit, competitor-data freshness window, the recommendation near-tie margin | Editable. Each is a `DatedValue` (`docs/business/calculations.md`): value, `validFrom`, `sourceUrl`, `owner`, `reviewBy`. A stale value blocks the answers that need it. |
| **Hard limits** (behavior rules in code) | PII masking, user-scoped data access, no payments or signatures, no credit decisions, output checks | **Read-only.** Each is listed with the eval cases that protect it. Changing one is a code change, never a form. |

### Regulations

A register, not the law text (regulations are translated into rules, not retrieved). Each entry: name and reference (for example OUG 50/2010), a plain-English summary, owner, `reviewBy`, and links to the parameters, hard limits, prompts and eval cases it affects. When a law changes, the entry shows everything to revisit.

### Knowledge

Documents (T&C, product sheets, fee information documents) and FAQs that Raiffy searches.

- Upload or replace a document with its version, date and source; edit FAQs with their paraphrases and metadata (`docs/decisions/product-decisions.md` → Knowledge and RAG).
- Numbers never live in FAQ answers; they come from the catalog.
- Publishing re-embeds the content.

### Prompts

Admins and operators can edit the prompts that shape Raiffy's answers. Operators propose, admins publish.

- **Editable:** per-pattern prompts (role, steps, tools, block recipe), the router's pattern descriptions, generator framing guidance, follow-up suggestion guidance, and the thinking panel's status lines.
- **Not editable here:** hard limits. They live in code and no prompt can loosen them; the output checks run whatever the prompt says.
- **Every prompt version runs that pattern's eval suite** before it can be published, and the results show next to the diff.
  - A failure in a safety or hard-limit case **blocks publishing**, for everyone.
  - Other failures can be published by an admin with a logged reason.
- One-click rollback to any earlier version.

### Reviews

The human verification queue from `docs/decisions/product-decisions.md` ("Cere verificarea unui specialist", "Verifică planul meu", automatic escalation).

- Each request shows the question, the answer with its blocks and sources, and the inputs. PII is masked by default; unmasking needs a logged reason. Opening a chat is always logged (GDPR).
- The operator **confirms** or **edits**. An edited answer is sent to the customer as a new signed version with the changes highlighted.
- **Escalated counter-offers** arrive here as their own request type. Each shows the client's request, Raiffeisen's list price and best in-band offer, the competitor offer with its source (uploaded SECCI or official store) and the total-cost comparison, the segment, and the approval level needed.
  - The reviewer approves a price (which returns to the chat as a personal offer with their name and an expiry), approves with conditions, or declines with a reason.
  - A reviewer can only decide cases at or below their approval level; higher cases show who to pass them to.
  - Every decision updates the counter-offer log.
- **Every edit creates a draft eval case** automatically: the question, the inputs, what the answer should have contained, and the operator's reason. The operator can also flag the cause (a product value, an FAQ, a parameter or a prompt), which opens a linked draft change.

### Evals

- Draft cases from reviews, waiting for an admin to accept, edit or reject them.
- Accepted cases join the suite and are exported for promptfoo.
- Run history per pattern and per prompt version, with pass rate over time. As the suite grows and the pass rate holds, the share of answers sent for automatic review can go down.

### Counter-offers

The counter-offer log and the **win-rate KPI** (`docs/shared/pricing.md` → Logging).

- Win rate by product, segment, competitor and resolution (in band or escalated), over time.
- Where the bank is losing on price: the competitors and segments with the most declines, the average gap to the competitor's total cost, and the reasons lost.
- How often a "cheaper" competitor offer disappeared at the total-cost step.
- Links from a band to its results, so the pricing team can widen or narrow it. A band change is a normal versioned change.
- Pseudonymized: customer identity is reachable only through the review case, with the usual logging.

### Audit

Every change, approval, rollback, unmasking and chat access: who, when, what (with the diff) and why. Filterable, exportable, never editable.

### Analytics

How Raiffy uses customers' account data and what comes of it. Prototype: `admin.html#analytics`. Logic: `lib/analytics/` (`summarize`, with Zod schemas and tests).

- **Aggregates only.** Records carry a pseudonymous conversation key and customer key, never a name, CNP, IBAN or balance. Any count below the `analytics-min` parameter (10 in the POC) is hidden, and so is any rate or median built on a hidden count. Looking at a single chat goes through Reviews, with the usual logging.
- Filters: date range, track, entry point (web or Smart Mobile).
- **KPIs:** conversations, share of answers that used account data, pre-approved offer take-up (shown → applied), share of fully digital applications, money saved from the ledger.

One section per account-data source:

| Section | Account data | Metrics |
| --- | --- | --- |
| Affordability and debt | Existing loans and cards; overdraft and card limits | Checks run, run without asking the customer, credit limits changed the result; refinancing, early-repayment and cash-need answers; fixed-rate-ending reminder sent → opened → acted on |
| Pre-approved offers | Bank-issued offers | Shown → opened → applied, by product; expired unused; average gap to the list rate; share issued by the bank (must be 100%, a hard limit) |
| Relationship pricing | Products held | "You already qualify" conditions shown; hidden costs caught; fee explanations given |
| Fees | Fees charged | "Why was I charged this?" questions, share answered without a handoff, most-asked fee lines |
| Savings | Deposits and savings | Deposit goals created and shown; maturity reminder sent → opened → acted on |
| Eligibility | Age and residency | Answers limited by maximum age at loan end or residency, by product |
| Digital or branch | Identity verification status | Digital vs branch applications, and why customers needed a branch |
| Applications and contracts | Application and contract events | Applied → signed → withdrawn → repaid; "Raiffeisen options only" turned on after a first signing; money-saved total, median per customer |

An **assistant quality** strip sits under them: evaluator first-pass rate, safe fallbacks, escalations to a specialist, and answers blocked by stale data, linked to the stale values in Products and Rules.

**Proposed definitions** (not specified elsewhere yet, confirm before building the pipeline side):

- **Money-saved ledger:** one `moneySaved` entry per signed contract or early repayment, in lei, against the customer's previous or alternative option, computed by the same deterministic tools as the quote.
- **"Raiffeisen options only" default:** after a customer's first signing, comparisons show only Raiffeisen options unless the customer asks for competitors. Each switch is logged.
- **Reminders:** `fixedRateEnding` (lead time from the `fixed-end-lead` parameter) and `depositMaturity` (`maturity-lead`), each with sent, opened and acted stages.

### Sentiment

How customers feel in their messages, and what came before the unhappy ones. Admins only. Prototype: `admin.html#sentiment`. Live: `/admin/sentiment`. Logic: `lib/analytics/sentiment.ts` (`summarizeSentiment`, with Zod schemas and tests).

- **Labels:**
  - Jev labels every customer message in its routing call: `sentiment` (positive, neutral, confused, frustrated, angry) and `sentiment_about` (answer, price, service, app, none).
  - The labels are for this page only; they never change routing or answers.
- **Stored per message:** pseudonymous keys, the track and entry point, Jev's pattern, the labels and their confidence, and what Raiffy's previous reply was. That last field is worked out in code and is one of: first, answered, unavailable, failed, stopped, menu, repeat. Never the message text.
- **Votes:** thumbs up and down on answers, with an optional reason after a thumbs down (wrong, unclear, missing, other). The latest vote per answer counts.
- **Privacy:** the same rules as Analytics. A group with fewer distinct customers than `analytics-min` is hidden, with any share built on it. Rows expire with the message retention period.
- **Sections:**
  - KPIs: conversations labelled, conversations with an unhappy message, confused, answers voted down;
  - unhappy messages per day;
  - how customers feel;
  - what unhappy messages were about;
  - what came just before;
  - by answer pattern;
  - why answers were voted down.
- **Before real users:** a Data Protection sign-off, and a line in the privacy notice. Labelling every message is processing for service improvement.

## Data model (Convex)

```ts
type Status = "draft" | "pending" | "published" | "rejected" | "rolledBack";

type Versioned<T> = {
  entityId: string;             // stable across versions
  version: number;
  status: Status;
  data: T;
  validFrom: string;            // ISO date; scheduled when in the future
  proposedBy: string;           // Clerk user ID
  approvedBy?: string;          // set only when an operator proposed it
  note?: string;
  createdAt: string;
};

// Tables, each holding Versioned<...> rows
// products, pricingRules, counterOfferBands, parameters (DatedValue), regulations, documents, faqs, prompts
// counterOfferLog and competitorOffers: append-only, shapes in docs/shared/pricing.md

type ReviewRequest = {
  id: string; conversationId: string; answerId: string;
  trigger: "customer" | "plan" | "escalation" | "qa" | "counterOffer";
  approvalLevel?: "specialist" | "branchManager" | "pricingCommittee"; // counter-offers only
  status: "open" | "confirmed" | "edited";
  operatorId?: string; diff?: string; cause?: { kind: string; entityId: string };
};

type EvalCase = {
  id: string; source: "review" | "manual"; reviewId?: string;
  pattern: string; input: unknown; expected: unknown; reason: string;
  status: "draft" | "accepted" | "rejected"; safety: boolean;
};

type AuditEntry = { at: string; userId: string; action: string; entity?: string; diff?: string; reason?: string };

// Analytics: answerTraces and outcomeEvents, append-only. Shapes in lib/analytics/schemas.ts
// (AnswerTrace: track, entry, intent, dataUsed[], evaluator result; OutcomeEvent: a discriminated union by kind).
```

## HTML prototype (`console.html`)

Most of the app UI is built in HTML first and converted to Next.js later, so the prototype should be complete enough to convert page by page.

- **Shell:** Daylight only, the same app shell as `chat.html`: a 240px sidebar (logo, the pages above with counts, the profile row), a header with the page title and actions, and the content area. Under 860px the sidebar becomes a drawer.
- **Demo role switch:** in the profile row, "Viewing as Operator / Admin" switches permissions live, so the approval flow can be shown end to end. Clearly labelled as demo-only.
- **Routing:** hash routes (`#home`, `#products`, `#products/personal-loan`, `#rules`, `#regulations`, `#knowledge`, `#prompts`, `#reviews`, `#evals`, `#counter-offers`, `#audit`). Mock data inline, in the shapes above, so it can move to Convex unchanged.
- **Key interactions to build:**
  - Edit a product value and see the impact preview, then submit as an operator, switch to admin, and approve.
  - A value past `reviewBy`, flagged across Home, Products and Rules.
  - A hard limit shown read-only with its protecting eval cases.
  - Edit a prompt, run its evals (scripted results), and see one blocked by a failing safety case.
  - Review a request, edit the answer, and see the draft eval case it creates.
  - Decide an escalated counter-offer with an uploaded competitor SECCI attached, and see the win-rate numbers update.
  - Roll back a published version.
- **Design rules** (`DESIGN.md`): tables with hairline rows and mono, tabular numbers; selection in ink; status pills on 12% tints. Diffs show added text on `#FFF3C4` and removed text struck through in `--text-3`, never red/green. Failing evals use the form error color (`--danger: #B42318`, already used in `login.html`), which should be added to `DESIGN.md` when this is built. Every value shows its source and review date.

## Build order

1. Shell, roles, Products with versioning, approval, publishing and audit
2. Parameters and the stale-value flags
3. Reviews, and drafting eval cases from edits, including escalated counter-offers
4. Evals page and the prompt editor with its eval gate
5. Knowledge and the regulations register
6. Counter-offer bands and the win-rate page
7. Impact preview and rollback

## Evals for the console

| Check | Source |
| --- | --- |
| An operator's change never reaches customers before an admin approves it | Roles and approval |
| An admin's change is published without a second approval, and the audit log records it | Roles and approval |
| Hard limits can't be edited from any console page or API | Rules for building · hard limits in code |
| A prompt version failing a safety eval can't be published by anyone | Prompts |
| A stale parameter blocks every answer that depends on it | Rules for building · no hardcoded facts |
| A quote keeps the version IDs it used; a later publish doesn't change it | `docs/individuals/calculations.md` |
| Unmasking PII and opening a chat are both logged with a reason | `docs/decisions/product-decisions.md` · operator access |
| Every edited review creates a draft eval case linked to it | Reviews |
| An escalated counter-offer can only be decided at or above its approval level | Reviews · counter-offers |
| Every counter-offer decision updates the log, and the win rate counts it | `docs/shared/pricing.md` · logging |
