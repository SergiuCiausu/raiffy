# Shared: Pipeline architecture

Applies to both tracks; business differences are in `docs/business/schema-and-pipeline.md`.

Every customer message goes through six steps. Three LLM workflows carry the judgment: the **router** decides what kind of question it is, the **orchestrator** splits multi-goal requests and decides the routes, and the **evaluator** enforces the behavior rules before anything reaches the customer. Everything with a number in it stays in deterministic code.

| Step | Component | Kind | Holds |
| --- | --- | --- | --- |
| 1 | Safety gate | Code + small classifier | Hard limits: crisis, fraud, hardship, AML evasion, prompt injection, PII masking |
| 2 | Router | LLM workflow (routing) | Pattern recipes, mode, model and tool selection |
| 3 | Orchestrator and subagents | LLM workflow (orchestrator-workers) | Goal splitting, per-goal pattern processing, cross-goal route decision |
| 4 | Composer and generator | Code + LLM | Calculations, block recipes; the 2–3 framing sentences |
| 5 | Evaluator | Code checks + LLM workflow (evaluator-optimizer) | Behavior rules, commission transparency, comparison honesty, language |
| 6 | Thinking panel and delivery | Frontend | Visible reasoning, then word-by-word streaming with interactive blocks |

The steps share one conversation state in Convex: detected language, mode, goals, the current pattern, the **inputs** the customer gave so far (each with its source) and any **pending inputs request**, slider values, the **current quote** (product, amount, term and price version, the baseline for any negotiation), tool results and evaluator verdicts. Each step reads it and writes its part, so any step can be logged, replayed and audited.

## Step 1: Safety gate

Runs before any LLM sees the message, and can stop the pipeline.

- **Mask PII** (cards, CNP, IBAN, passwords) in code, then pass only the masked text on.
- **Classify risk** with a small, fast classifier: crisis, fraud or scam, hardship, AML evasion, prompt injection, abuse.
- **Set the mode** in conversation state: `crisis`, `fraud` and `hardship` override any pattern the router would pick; `crisis` and `fraud` skip straight to their fixed scripts and actions (helplines, card freeze, human handoff).
- **Detect the language** and store `locale`.
- Every gate decision is logged with the classifier's confidence; borderline crisis or fraud scores err on the safe side.

## Step 2: Router (routing workflow)

A fast LLM call that classifies the message and sends it down a specialized path. It holds the **answer pattern catalog** (the eleven patterns, their triggers and tool lists) and nothing else, so its prompt stays short and accurate.

It returns structured output:

```ts
type Route = {
  goals: number;                  // 1 = single goal, 2+ = multi-goal
  pattern: PatternId | "freeform"; // for single-goal messages
  scope: "compare" | "solution" | "detail"; // how many options to show, see answer-patterns.md
  difficulty: "simple" | "complex";
  missing: string[];              // details to ask for, e.g. ["price", "term"]
  confidence: number;
};
```

| Router decides | Then |
| --- | --- |
| Two or more goals ("buy a car and refinance my mortgage") | Always go to the orchestrator (step 3) |
| One goal, simple pattern (explain a term, fees, a status question) | Small, fast model with that pattern's prompt and tools |
| One goal, complex pattern (purchase goal, debt, life event, comparison) | More capable model, still through the orchestrator as a single-goal plan so routes are decided the same way |
| Negotiation on any turn ("can you do better?", a competitor's offer) | Pattern 11, with the current quote as the baseline; on a first message, scope `compare` |
| Confidence below threshold | See "Pattern confidence" below; never a guessed pattern |
| Mode set by the gate | Mode wins; the router only adds the pattern for later context |

Each pattern gets its own short prompt (role, its 5 steps, its tools, its block recipe) instead of one giant system prompt, so tuning one pattern can't break another. Evals: a routing test set of 200+ real phrasings across languages, measuring pattern accuracy and multi-goal detection.

**Pattern confidence** (`lib/agent/confidence.ts`). Jev classifies; code decides, in this order:

1. **Risk checks first.** They run on every message, including replies to Raiffy's questions and tapped choices.
2. **Pending question.** If Raiffy just asked for inputs and the message answers it (Jev's `answers_pending`, or the parser fills an asked input, or the customer used the inputs card), the conversation keeps its pattern.
3. **Tapped choice.** A choice chip sets the pattern, but only one Raiffy offered on its last turn.
4. **Jev's label.** Route when its confidence clears the label's floor (`thresholds.perInquiry`, default `routingConfidence`), or when it leads the runner-up by `routingMargin`. If the top two together reach `candidatePair` and need the same required inputs, route to the first and let the inputs request settle it.
5. **Fallback model.** Otherwise a small Haiku call picks one of the candidate labels or says "unsure". It sees only the screened message, the structured context and the candidates; it never sees risk questions or extracts numbers.
6. **Choice chips.** Still undecided: one line and a chip per candidate. Only when even the candidates are unclear does Raiffy ask the generic question.

**Customer figures and euro amounts.** The answer's number check (`checkNumbers`) accepts the customer's own stated inputs (amounts, terms, payments, and the short form they wrote, such as the "50" in "50k"), never rates and never figures derived from them (`customerAllowedFigures` in `lib/agent/inputs.ts`). A euro amount is never converted (no dated exchange rate is connected); if the sources show only lei products, Raiffy says so and uses the same number in lei as a labelled example. Solution answers get a larger passage budget (`maxPublicChunksSolution`, 9) and, until the comparison calculator is connected, recommend one route by fit with the stated purpose, amount and term, with the reason and when another route fits better.

**"Other" is not a dead end.** Jev's `other` label excludes any request to borrow, save, pay or open a product, even without a purpose ("a credit of 50k euro" is `purchase_goal`, which then asks what it's for). If Jev still answers `other` but a keyword reading of the message (`bankingIntent`, EN and RO) finds a clear banking request, the hinted patterns become candidates for step 5 and then chips. A message with no recognisable request gets chips from Jev's top labels.

Only the pattern needs confidence. An unsure scope follows from the pattern (`compare` when options are named), and an unsure complexity uses the stronger model. Thresholds are provisional until the live routing eval calibrates them; every answer stores Jev's full inquiry distribution for that.

**Inputs gate** (`lib/agent/inputs.ts`). Before the answer model runs, code reads the pattern's inputs from the message (an EN/RO parser for amounts, terms and rates, keywords for choices), earlier turns, and account data or confirmed memory where connected. Choices the keywords miss go to a second Jev request, then the fallback model; numbers only ever come from the customer's own text. If a required input is still missing, Raiffy replies without the answer model: one line plus an `inputs_request` block with at most 3 fields, for at most 2 rounds, then it answers with what it has. The answer model receives every required and optional input with its value or `null` and its source.

## Step 3: Orchestrator and subagents (orchestrator-workers workflow)

Mandatory for every multi-goal request, and used as a one-goal plan for complex single goals so routes are always decided the same way. The orchestrator is the most capable model in the pipeline; it holds the **financing-route rule**, the **financing routes catalog** and the customer's overall picture (income, obligations, savings).

**3a. Split into goals.** The orchestrator turns the message into a goal plan:

```ts
type GoalPlan = {
  goals: {
    id: string;
    summary: string;          // "buy a 2016 BMW X5, ~100,000 lei"
    pattern: PatternId;       // purchase_goal, debt_refinancing, saving_goal…
    priority: number;         // what the customer cares about most
    sharedBudget: boolean;    // competes for the same income or savings
    missing: string[];
  }[];
  constraints: string[];      // "keep monthly payments under 3,000 lei"
};
```

Example: "We're having a baby, want to buy a bigger car and maybe refinance the mortgage" becomes three goals: life event (baby costs), purchase goal (car), debt refinancing (mortgage), all sharing one budget.

**3b. Subagents process each goal.** One subagent per goal runs in parallel, each with its pattern's prompt and tools. It calls the deterministic tools (catalog, calculator, DTI, TCO, comparison, eligibility), never computes numbers itself, and returns a structured result: candidate financing routes with monthly cost, total cost, commissions, eligibility and risk, plus the blocks for that goal. Subagents never talk to the customer.

**3c. Orchestrator decides the routes.** The results come back to the orchestrator, which looks across goals, because the best route for one goal can break another:

- **Combined affordability**: it re-runs the DTI tool with all chosen routes together; if the total passes the BNR cap, it picks cheaper routes, longer saving, or a different order.
- **Sequencing**: it can recommend an order (refinance first to free up monthly budget, then finance the car).
- **Shared savings**: it allocates savings across goals instead of counting them twice.
- **Conflicts**: when goals can't all fit, it says so and offers trade-offs rather than hiding one.
- It returns a **decision**: chosen route per goal, the reason, the order, and the alternatives the customer can switch to.

**3d. Synthesizer.** The orchestrator's decision and the subagents' blocks are merged into one `Answer`: a short overview, then each goal's blocks in priority order, and a combined `affordability` block for the whole plan.

Practical rules: subagent outputs are validated against the schema before the orchestrator sees them; a failed subagent becomes a `partial` goal with a note, never a silent gap; the orchestrator can ask one clarifying question for the whole plan instead of one per goal. Evals: multi-goal cases where goals conflict, where combined DTI exceeds the cap, and where one goal lacks data.

## Step 4: Composer and generator

- **Composer (code)** builds the blocks from tool results using the pattern recipes, fills `sources[]` and `actions[]`, and sets `flags` (stale data, indicative only, suppress offers). It holds the **calculations** layer.
- **Generator (LLM)** writes only `text`: two or three sentences in the customer's language that frame the blocks and state the orchestrator's decision and reason. It receives the blocks as data and may only mention numbers that appear in them.

## Step 5: Evaluator (evaluator-optimizer workflow)

The evaluator holds the **behavior rules** and **regulatory wording rules**, and checks every answer before the customer sees it. It is a separate LLM call with its own prompt, so the generator can't grade itself.

**5a. Deterministic checks first** (code, instant, certain):

| Check | Rule from |
| --- | --- |
| Every number in `text` matches a block value | Hard limits · output safeguards |
| Each route lists commissions, or `hasNoCommissions` is confirmed true | Commission transparency |
| Option count matches the answer scope (named options, at least three, or one plus a follow-up question) | Answer patterns · core rule |
| A cheaper competitor in the data is shown and followed by a counter-offer | Pattern 2 |
| AI disclosure present on first message; answer in English (POC) | Behavior rules · disclosure |
| `suppressOffers` respected in hardship and crisis | Behavior rules · sensitive situations |
| Schema valid for every block | Answer schema |

**5b. LLM evaluator** for what code can't judge, with a rubric it scores as pass or fail per item, plus feedback:

- No investment recommendation phrasing ("you should buy fund X"); advice offered through an adviser instead.
- No pressure, urgency, guilt or misleading omissions; no belittling of competitors.
- Favoring Raiffeisen only openly (ordering, personalization, counter-offers), never by hiding or skewing.
- The orchestrator's recommendation actually follows from the data and the customer's stated priority.
- Tone fits the mode: empathetic in hardship, calm and directive in fraud, plain language for vulnerable customers.
- Refer-outs present where needed (tax, legal, investments, insurance sales).

**5c. The loop.** On a fail, the evaluator returns specific feedback ("text says 1,650 lei, the block says 1,696 lei"; "BT is cheaper on total cost but not mentioned") and the generator, or the orchestrator if a route decision failed, retries once. A maximum of two loops; if it still fails, Raiffy shows a safe minimal answer (the blocks with neutral framing, or a handoff to a human) and the case is logged for review.

Practical rules: the evaluator prompt is versioned with the behavior rules, so changing a rule means updating one place; every verdict is stored for audit; a weekly sample of passed answers is reviewed by a human to catch evaluator blind spots. Evals: a set of deliberately bad answers (wrong number, hidden commission, pushy tone, missing competitor) that the evaluator must catch.

## Step 6: Thinking panel and delivery

While steps 2 to 5 run, the customer watches a **thinking panel**; once the evaluator approves, the official answer streams in word by word with its interactive blocks.

**The thinking panel**

- A collapsible panel above the answer area, dimmed and in a smaller monospace style so it clearly reads as work in progress, not the answer.
- It streams progress events from each step, translated into the customer's language:
  - "Understanding your question: 1 goal, buying a car"
  - "Checking financing routes: savings, personal loan, car loan, leasing"
  - "Leasing: car is older than 8 years, not eligible"
  - "Comparing with Banca Transilvania and BCR"
  - "Checking your budget against the BNR limit"
  - "Reviewing the answer for accuracy and fees"
- For multi-goal requests it shows one lane per goal with its own progress, then "Deciding the best order across your goals".
- It also shows the generator's draft text as it's written, in the dimmed style.
- **What it never shows**: unverified numbers, raw model reasoning, internal rules, AML or fraud signals, evaluator feedback text, or anything a later step might reject. Steps emit short, pre-written status messages with safe parameters, not free model output.
- If the evaluator rejects a draft, the panel shows "Double-checking the numbers" rather than the error.
- After delivery, the panel collapses to a one-line "How I worked this out" toggle the customer can reopen, listing the steps and sources used.

**Official delivery**

- Only an evaluator-approved `Answer` is delivered.
- `text` streams in word by word (about 25–60 ms per word) with a blinking caret, the way `chat.html` does it.
- Blocks follow in recipe order, each fading in after the previous one, with charts animating to their values (gauge needle sweeping, cost bar filling).
- Interactive controls (sliders, buttons, counter-offer) become active as soon as their block appears.
- Under `prefers-reduced-motion`, everything appears with a simple fade, no movement; screen readers get the text through an ARIA live region once, not word by word.
- In `crisis` and `fraud` modes, the thinking panel is skipped and the fixed script and actions appear immediately.

**Latency budget**: the panel's first line within 300 ms of sending; a simple answer within 3–4 seconds; a multi-goal plan within 10–15 seconds, with the panel showing progress throughout.

## Hackathon scope

Build all six steps, keeping it lean: the safety gate as keyword rules plus one classifier call, the router as one fast LLM call, the orchestrator handling one and two-goal requests with parallel subagents, deterministic checks plus the LLM evaluator with a single retry, and the thinking panel streaming pre-written status lines. Demo the multi-goal case right after the BMW X5 story, so judges see the orchestrator decide across goals.
