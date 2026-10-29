# Raiffy build progress

Tracks what has been built, what's in progress, and what's next. Update it whenever a piece lands.

Last updated: 2026-10-29 (merge of `main`'s demo fixes into `starter-vignette-motion`, PR #9). Branch: `starter-vignette-motion`.

## Latest main retained, voice added 2026-10-29

- Replaced the interrupted merge with a clean branch based on current `origin/main` at `131fe19` (PR #9). `convex/`, backend `lib/`, catalog, agent configuration, authentication and the newest chat cards remain identical to main. The full previous local UI/voice checkpoint is preserved at `81553c3`; the paused merge and lockfiles are also backed up under `/tmp/raiffy-main-voice-20261029`.
- Added only the local voice runtime/assets and controls to the current authenticated `AgentChat`. Dictation and hands-free sends use the existing send/run API. Narration follows the exact allocated, checked assistant reply and cancels on Stop or navigation. Read-aloud remains Phonon/Preston on-device; STT remains local VibeVoice. No Convex deployment, import or provider call was performed for this integration.
- Validation: 693 backend tests pass with one existing skip; 90 web tests, 10 Python guards, root/Convex/web TypeScript, scoped frontend lint, and the production build pass. Synthetic browser QA exercised transcription → current chat send → checked-answer playback → Stop without a physical microphone or paid model calls. Real microphone/provider acceptance was not repeated.
- The existing generated-agent-setup consistency check fails on main (`agents/raiffy.agent.yaml` is stale). That upstream configuration was intentionally retained, rather than changing backend behavior during the voice merge.

## Merge with main (PR #8 demo fixes), 2026-10-29

The branch's agent pipeline is the base; main's features are ported into it.
- **Kept from the branch:**
  - routing: an unsure pattern gets choice chips (with the fallback model), never public documents only;
  - the audience label never asks personal or business.
  - main's opposite rules for both were left out, with their tests and the `"salut"` eval case.
- **Ported from main:**
  - memory proposals with consent, inspect and forget answers (`memoryResponse`), and the memory panel;
  - the adviser handoff action and `handoffRequests`;
  - follow-ups that name the product or route;
  - one Jev retry after `invalid_response` or `provider_error`;
  - uncertain goal count → the stronger model;
  - the per-search evidence cap for solution and compare answers;
  - `customerStatements` in the number check.
- **Two calculators, two tools:**
  - The branch's catalog-backed `calculate_scenario` (loan and overdraft cost) keeps its name.
  - Main's debt-service check is now `check_affordability` (same input, `calculation: "loan_affordability"`), offered on affordability and purchase routes.
  - Two tools with one name can't both be offered to the model.
- **Prices:**
  - The branch's demo rule stands: figures are shown as fetched when a cited passage backs them.
  - Main's `withholdFinancialFigures` and the catalog-required replacement stay in `lib/rag/agent.ts` but are off in `convex/agent.ts`.
- **Route cards:**
  - Main's text-derived routes block (`routesFromAnswer`) is still composed, only when no checked routes card exists, and drives the route follow-ups.
  - The chat keeps the branch's Markdown renderer, which already shows that list as a list card, so `RouteCards` (now class `text-routes`) isn't drawn in the chat yet.
- `RAG_PROMPT_VERSION` is `rag-agent@12`.

## Admin area: Home, Products, Rules, Analytics and Audit log, read-only, 2026-10-29

- **Pages:** `/admin` (Home, no longer a redirect), `/admin/products`, `/admin/products/[productId]`, `/admin/rules` and `/admin/audit`, converted from `admin.html` over live Convex data. Admin-only through `components/staff/AdminPage.tsx`; Convex checks the role again on every read.
- **Backend:** `convex/adminViews.ts` (tested):
  - `products` and `product`: Raiffeisen's product pages with their imported values. Each value shows its quote, source, review date, who signed it off, and whether answers may use it (the `get_product_terms` rule, `lib/catalog/review.ts`). Due means within 14 days of the review date. New permission `catalog.read` (operators and admins).
  - `audit`: the audit log with names from the `users` mirror; the page filters, searches and exports CSV.
  - `home`: products with values past review, due or waiting for a sign-off, open escalated counter-offers (count only, decided in the console), the last 5 changes, and last week's conversations, answers and failed replies.
  - `rules`: `lib/agent/rules.ts`. Hard limits list the files that enforce them and their eval cases; a test fails if an eval ID or a file doesn't exist. Parameters are read from where the code defines them (`AGENT_POLICY`, `REVIEW_DAYS`, message retention, `ANALYTICS_MIN_GROUP`), so the page can't drift.
- **Read-only by design:** no edit, approve, schedule or rollback controls yet. The prototype's versions, owners, pending and scheduled states, impact preview and stale-parameter blocking need the versioned change workflow (console.md build order step 1), planned separately.
- **Analytics** (`/admin/analytics`, `convex/analytics.ts`, tested): `convex/agent.ts` records one `answerTraces` row per delivered answer, best-effort like sentiment. A row holds pseudonymous keys, the track, the intent (from Jev's inquiry), which kinds of account data the tools actually read (`lib/analytics/trace.ts`; `DATA_SOURCES` gains `transactions` for the expense summary), retries, fallback and escalation. No text or figures. It expires with message retention (hourly cron). The page shows conversations, answers, the share using account data, first-pass checks, fallbacks, answers per day and data usage, through `summarize()` with groups under 10 hidden. Offers, applications, contracts, reminders, fees, eligibility and money saved need outcome events and are listed as "Not connected yet", never as zeros. `staleBlocked` is always false until catalog gaps are reported per answer.
- **Not done:** Only 5 of the ~146 Raiffeisen product pages have imported values so far, so most products show "No values imported". The pages were checked by typecheck and tests, not yet with a signed-in admin in the browser. Not yet deployed to the dev deployment (the push also ships the bank-layer changes, pending a decision).

## Sample customers with Smart Mobile holdings (policy `raiffy-agent@14`), 2026-10-29

- **Bank layer** (`lib/bank/schemas.ts`, `holdings.ts`, `persona.ts`, tested): a customer's Raiffeisen holdings as Smart Mobile shows them:
  - current accounts (masked IBAN, balance, overdraft limit, use, rate and renewal);
  - savings accounts;
  - term deposits (amount, rate, term, maturity, renewal);
  - loans (principal, amount left, monthly payment, rate type and rate, fixed-rate end and what follows, payments left, early-repayment fee);
  - cards (limit, use, annual fee and due date, how often used);
  - bank-issued pre-approved offers;
  - age, residency and digital-signing status.

  Each holding has a stable reference (`loan_fr1`) and links to the real Raiffeisen product in the `products` catalog. Dates are relative to today, so the sample data never goes stale. Balances, the overdraft and Raiffeisen loan payments in the generated statements come from the holdings (`withHoldings`), so the two never disagree.
- **Ten sample customers** (`convex/seed/demoPersonas.ts`). The six existing ones keep their IDs and figures and now hold products. Each one tests a scenario:
  - a credit card hardly used, with its fee due in 18 days;
  - an overdraft used for months;
  - a pre-approved personal loan;
  - a deposit maturing in 6 days, with idle cash;
  - a mortgage at another bank;
  - a credit card near its limit;
  - **new:** a Casa Ta mortgage whose fixed rate ends in 3 months;
  - **new:** a personal loan half repaid, with savings that could clear it;
  - **new:** 63 and asking about a long mortgage;
  - **new:** identity not verified for digital signing.
- **Six switches**, as in Smart Mobile: accounts and overdraft, transactions, savings and deposits, pre-approved offers, loans, cards (`chat.html`, `AccessPanel.tsx`, `convex/accounts.ts`). Older rows keep working: their "cards" switch meant card spending and now reads as "transactions".
  - The expense summary splits into `account` (balance and overdraft), `flows` (income, outgoings, debt, fees) and `spending` (by category, subscriptions, ATM and FX).
  - The inputs gate takes income and debt payments from transactions, or Raiffeisen loan payments from the loans switch alone.
- **`get_holdings`** (`convex/accounts.ts`), a host tool on purchase, affordability, refinancing, saving, explanation, fees, life events, cash shortfall, negotiation and spending questions.
  - It returns one citable per holding, labelled as sample data with masked numbers, with the product page in its text. The number check applies to each.
  - A kind that's switched off is named, never returned as empty.
- **Catalog fix:** "fără ipotecă" loans were counted as mortgages; now they're personal loans (Raiffeisen: 4 mortgages and 3 personal loans, not 6 and 1).
- **Assigning test customers (step 4):**
  - On `/admin/users`, admins pick one of the ten sample customers for each user ("Sample customer" column). Edits to roles and sample customers stay pending, marked on their row, until the table's save bar saves them all with one reason (`SaveBar.tsx`, `saveUserChanges` server action, batch checks in `web/lib/user-changes.ts`, tested): your own role and leaving no admin are refused across the whole batch, each change is applied on its own, and failed rows stay marked with their error. The prototype is `admin.html#users`. Convex re-checks the admin role (`accounts:assignSample`) and writes `user.sample_assigned` (details `from`/`to`) to the audit log in the same transaction. The "Recent changes" list shows it next to role changes.
  - An assignment sets the tester's sample account with every switch off: the tester still chooses what Raiffy may read. Users who haven't opened Raiffy yet can't be assigned (no Convex user row).
  - Testers see "Your admin assigned …" in "What Raiffy can see", and "Reset sample data" (`accounts:resetSample`) returns them to that customer with everything off. Sample data is read-only seed data, so a reset never loses holdings.
- **Not done:** the Smart Mobile launch context (step 5), and the account-scenario eval set and scripted browse pass (step 6). Card transactions don't yet include the annual card fee or deposit interest. Pre-approved offers in `get_holdings` are separate from the pricing flow's computed quotes. Not deployed, and `products.import.jsonl` needs re-importing for the mortgage fix.

## Chat sentiment in the Admin area (policy `raiffy-agent@13`), 2026-10-29

- **Labels:** Jev labels every customer message in the same call that routes it, with two new questions in `lib/agent/jev.ts`:
  - `sentiment`: positive, neutral, confused, frustrated or angry;
  - `sentiment_about`: the answer, a price, the bank's service, the app, or none.
  Both are optional in the response schema, so older recorded responses still validate. The labels never route, answer or treat a customer differently.
- **Storage:** `convex/agent.ts` records one `sentimentEvents` row per message after routing (`convex/sentiment.ts` `record`). Best-effort: a failed write is traced and never breaks the turn.
  - A row holds labels only: pseudonymous SHA-256 conversation and customer keys (salted with `ANALYTICS_KEY_SALT` when set), the track, the entry point, Jev's pattern, the labels with their confidence, and `after`.
  - `after` is what Raiffy's previous reply was: first message, a checked answer, an answer it couldn't give, failed, stopped, a menu, or the same question asked again. It's worked out in code from the stored messages.
  - Message text is never copied.
- **Votes:** thumbs up and down are now saved (`sentiment:rate`, `answerFeedback`). A thumbs down shows an optional "What was wrong?" row: Wrong, Unclear, Missing information, Something else (in `chat.html` and `AgentChat.tsx`). The latest vote per answer counts.
- **Retention:** both tables expire with the message retention period; an hourly cron removes expired rows.
- **Aggregation:** `lib/analytics/sentiment.ts` `summarizeSentiment` (tested). Any group with fewer distinct customers than the minimum (10) is hidden, and so is every share built on a hidden count. One customer with many messages is still one person.
- **Page:** `admin.html#sentiment` (prototype with seeded mock data, admin-only in the role switch) and live `/admin/sentiment`. The page shows:
  - KPIs: conversations labelled, conversations with an unhappy message, confused, answers voted down;
  - unhappy messages per day, with a data table;
  - how customers feel, and what unhappy messages were about;
  - what came just before an unhappy message;
  - by answer pattern;
  - why answers were voted down.
  `convex/sentiment.ts` `summary` checks the admin role and never lowers the minimum group size.
- **Not done:** a Data Protection sign-off and a privacy-notice line before real users (labelling every message is processing for service improvement). `ANALYTICS_KEY_SALT` isn't set in the Convex env yet. Smart Mobile traffic is recorded as `web` until that entry point exists. Drilling into the chats behind a number goes through Reviews, which isn't linked from the Admin area by design. No eval set yet for the sentiment labels.

## Comparison card phases 3–4: catalog-built rows in the live chat, 2026-10-29

- **Phase 3:** `convex/compare.ts` adds the `compare_products` host tool. It's offered when the route has `get_product_terms` and the answer compares products (scope compare, or the `product_comparison` pattern).
  - It reads the track's catalog, limited to the banks the turn's collections allow, for exactly the product IDs the model passes.
  - It builds `fromCatalog`. The customer's amount and term count only when they appear in the customer's own words; "5 years" grounds 60 months.
  - It returns one citable per product with every row as the card writes it.
- **The block:** `lib/compare/block.ts`, 8 tests. `comparisonBlock` turns any comparison into one `compare_table` block:
  - the catalog table, using the customer's names for the products (lined up by bank, not by position), with the model's cited facts filling its gaps;
  - or the model's facts alone. The documents card in the screenshot becomes the three document rows.
  - A value whose source the answer doesn't cite reads "Not in the sources".
  - The model's comparison card isn't shown separately any more. The recommendation stays only if it names a product on the card.
  - `convex/agent.ts` builds it next to the spending and price cards, and `composer.ts` accepts it.
- **Phase 4:** `web/components/agent/CompareTable.tsx` shows group headings, a citation per value, "Not confirmed" and "Not in the sources", the bold deciding row, and the yellow light only on a single cheaper exact option. It also shows the notes on payments and DAE examples, and "Why I recommend" when there is a recommendation. `cardNames` hides text that repeats the product names.
- **Suite:** 621 passing. `convex/agent.test.ts` "screens stored messages…" timed out once at 5.07s under the full parallel run and passes alone.
- **Not done:** not deployed to Convex, and not seen in the live chat (that needs a deploy and a signed-in run).

## Comparison card: fixed rows with amounts and commissions (phases 1–2), 2026-10-29

- **Phase 1** (`chat.html`): a new `bankcompare` card, Flexicredit vs Credit George, from the reviewed catalog terms.
  - Groups and rows: Cost (DAE, interest rate), Amounts (amount, term) and Commissions (analysis, administration and early repayment fees).
  - A citation on every value, a "Not confirmed" chip and "Not in the sources" text, and a note explaining why there's no monthly payment and why the DAE examples aren't compared.
  - The mock block mirrors `CompareTable`. Asking about BCR, ING, BT or BRD (and not about documents) routes to it.
  - The header button is renamed "Talk to a specialist" here too.
  - Checked at 900px and 390px with no horizontal scroll and no console errors. Prototypes are synced (`pnpm sync:prototypes`).
- **Phase 2** (`lib/compare/`, 12 tests): the row keys and groups.
  - `rowForTerm` (catalog terms) and `rowForLabel` (the model's English or Romanian fact labels), and `focusOfLabels`.
  - `fromCatalog`: unreviewed, stale, unquoted and stated-missing terms are "not confirmed". Monthly payment and total cost come from `repaymentSchedule`, but only with an exact reviewed rate and confirmed lei fees; otherwise `paymentUnavailable`. The yellow light goes only to a single cheaper option on exact, comparable values.
  - `fromFacts`: the documents card from the screenshot maps to document rows only.
  - `mergeTables`: catalog first, search fills the gaps.
- **Not done:** phase 3 (a `compare_products` host tool over raiffy-0f's `queryTerms`) and phase 4 (the web `Comparison` renderer). The live chat still shows the model's own rows.

## Timing input, retrieval tuning and catalog-first answers (policy `raiffy-agent@12`), 2026-10-29

- **"When do you need it?"** (`lib/agent/inputs.ts` `needBy`, policy `@11`): an optional input on purchase goals and cash shortfalls. It reads "in 8 months", "peste 2 ani", "as soon as possible" or a tapped choice (Now, Within 6 months, Within a year, In 2 years or more, Not sure yet; `NEED_BY_MONTHS`). A deadline phrase is blanked before figures are read, so it never becomes the loan term, and "pay it back in 2 years" stays a term. `compare_routes` now takes the customer's stated timing over the model's `timing`, which is only the fallback (`lib/advice/tool.ts`, `convex/advice.ts` `adviceStatedOf`). "Not sure yet" and defaults stay unknown. When the recommendation waits on timing, the answer offers the four timing replies as follow-ups (`NEED_BY_REPLIES`, `generate()` returns `needsTiming`).
- **Retrieval** (`lib/rag/search.ts`): the vector ranking now weighs 1.5× the keyword ranking in fusion, and the glossary gained borrow, repay, grace period, interest-free and issue. Measured with a local harness that reproduces the live search over the exported chunks (exact cosine on the stored embeddings, BM25 standing in for Convex's keyword index; it matches the published live numbers within a few points): hit@5 68% → 71% overall, competitors 56% → 60%, Raiffeisen set 78% → 80%, hit@1 on Romanian queries 47% → 53%. Tried and dropped: capping chunks per page (page@5 rose to 92–96% but passage hits fell, because the expected passage is often a page's second chunk) and reordering a page's chunks by query terms (worse on every set). The English rows understate live quality: the RAG prompt already tells the model to search in Romanian, and the paired questions score 86% in Romanian vs 72% in English. Remaining misses: BCR deposit rates in PDF tables (an English page of BCR's site wins), and answers split across neighbouring chunks.
- **Catalog first** (`lib/catalog/products.ts`, `lib/catalog/query.ts`, `convex/catalogQuery.ts`): a `products` table with one row per product page, built from chunk metadata (`pnpm catalog:build-products`: 423 products, 16 guide pages marked). Each row has a kind (the chat's product kinds), a link, a short description and the chunks' scope flags. `query_catalog` is a host tool with typed filters (products or terms; bank, product kind, IDs, kind of term, currency, term, rate type, sort, limit), never free-form queries. The host fixes the track and the readable banks: Raiffeisen with bank docs, ING and BCR only with competitor docs. Reviewed terms come back as reviewed; unreviewed ones come back labelled "not reviewed yet: a dated public figure copied from the bank's page on DATE". Stale, unquoted and stated-missing terms are gaps, never values. On a listing, and on a comparison, fee or explanation question with a known product kind, the host runs the catalog query before the model (`runAgent` `preload`, shown as the model's own earlier call), so the database is the first layer in code. The system text tells the model a catalog row overrides a passage.
- **Tests:** inputs (needBy evals in `evals/agent-inputs.json`), advice inputs, `lib/catalog/{products,query}.test.ts`, the preload in `lib/rag/agent.test.ts`. The suite is at 609.
- **Deployed** 2026-10-29 01:31 to `diligent-rhinoceros-830` (the whole working tree), with 423 rows imported into `products`. Checked through the deployed `catalogQuery:allProducts` and `termsOfTrack`.
- **Not done:** the term catalog still has only 72 terms for 13 products; extracting terms from every product page and tariff PDF is the next step for the catalog to answer most rate and fee questions. PDF tables aren't re-chunked yet. No live eval yet of catalog-first answers against search-only answers (it costs model calls).

## Catalog in the cloud, personal-loan terms reviewed, 2026-10-29

- **Imported** `productTerms.import.jsonl` (72 terms) into the cloud dev deployment. The table was empty, so it used `--append`; `--replace` was refused by the permission check because it deletes rows.
- **Reviewed:** the admin (`user_3LKlwBzh15hFKFyhVVTG1IfcxKi`) signed off all 16 personal-loan terms with a quote, through `catalog:markReviewed`, each with its own audit entry.
  - **Raiffeisen Flexicredit, 6:** rate 5.55–17.95%, up to 50,000 euro (the page states euro, so this isn't a seed error), up to 60 months, analysis fee 200 lei, administration fee 5 lei a month, DAE in the example 9.49%.
  - **ING Personal, 4.**
  - **BCR Credit George, 6:** rate 6.29–14.99%, up to 250,000 lei, up to 60 months, analysis fee 200 lei, administration fee 0 lei, DAE in the example 9.94–16.41%.
- **Not reviewable** (no quote on the page): ING's maximum amount and ING's DAE.
- **Still missing for an exact plan or payment:** every bank publishes its rate as a range, so `buildPlan` and `compare_routes` still return `rate_not_exact`. The comparison card will show "from" figures.
- **Decision:** a comparison about documents shows only document rows, with no cost rows.

## Booking a call with a specialist, 2026-10-29

- **Renamed** "Talk to an advisor" to "Talk to a specialist" (user decision). The header button now opens the booking card directly, with no message and no model call. The handoff card's button sends "I'd like to talk to a specialist about this.", which routes to `human_contact`.
- **Rules** in `lib/booking/` (schemas and rules, 13 tests), the same ones as `console.html`:
  - slots come from weekly hours, breaks, days off, a buffer, a daily cap, a 2-hour lead time and a 14-day horizon;
  - wall-clock times are in Europe/Bucharest (the clock change is tested);
  - one open call per customer, release if not confirmed 24 h ahead, a 30-day pause after two no-shows;
  - the join window, the share window, and a pseudonymous customer reference with first name and initial.
- **Convex:**
  - tables `operatorAvailability`, `bookings` and `bookingEvents`;
  - `convex/bookings.ts` (8 tests): `options`, `book`, `confirm` and `cancel` for the customer (owner only); `setAvailability` (an operator for themselves, an admin for anyone, audited); `agenda`, `operatorCancel` (the reason is shown to the customer) and `recordOutcome` for operators; a `releaseUnconfirmed` cron every 15 minutes.
  - The client never sends a slot list: `book` recomputes the open slots and refuses anything else.
- **Chat:** `web/components/booking/BookingCard.tsx` appears under the header button and under every `human_contact` answer. It handles picking a time, call type and topic. Plan sharing is offered only when the thread has a plan, and starts unticked. Once booked, the card shows the confirm reminder, "starts soon" and "Join video call" (a demo Jitsi room, shown only inside the join window). It also covers cancelling, notices when the operator cancels or the call is released, and the pause. The `human_contact` text now points at the card.
- **Demo labels:** the video room is public Jitsi, nobody phones, and the card header says "Demo".
- **Not done:**
  - no operator page in `web/` (the functions exist; `console.html#calendar` remains the reference);
  - no chat-summary sharing: only a plan the customer chose to share;
  - no push or email reminders: they're in-app only;
  - not deployed to the cloud dev deployment, and no operator hours seeded (see `web/README.md`).
- **Suite:** 584 passing; root and web type checks are clean.

## "Talk to a person" routing (fix 2), 2026-10-29

- **Bug**: "How can I book a meeting with a Raiffeisen advisor?" (the `/chat` header button's text) matched none of Jev's labels, so it got the "Which of these is closest?" menu with three choices that didn't fit.
- **Fix**: a new inquiry label, `human_contact` (`lib/agent/jev.ts`), with its own handler and a fixed answer. It makes no model call: talk to someone at a branch or through the official contact channels on raiffeisen.ro; booking from the chat isn't connected yet; Raiffy can help prepare questions and documents. It says nothing is booked and gives no time or figures. Chip label: "Talk to someone at the bank".
- **Keyword path**: a hint row in `lib/agent/confidence.ts` (English and Romanian: book, schedule or arrange a meeting, appointment or call; talk or speak with a person, adviser or specialist; programare; vorbesc cu un consilier) settles Jev's ambiguous split or "other" to `human_contact`. It never overrides a confident pattern, a risk route or a tapped choice.
- **Tests**: 5 in `lib/agent/agent.test.ts`, including the screenshot's split. Plus 6 cases in `evals/agent-routing.json` for `pnpm agent:eval-routing --live`, one of them a question *about* advisers that must stay `professional_advice`. Policy is `raiffy-agent@9`, setup rebuilt, and the suite is at 531 passing.
- **Not done:** the button still sends text (fix 1, the booking card, waits on the booking decisions). The live Jev routing eval wasn't run.

## No "personal or business?" question, 2026-10-29

- `lib/agent/route.ts` no longer stops with `confirm_track_before_access` when Jev labels the audience business or isn't sure. Every account is treated as an individual: the plan stays on the signed-in track (personal), and retrieval stays filtered by that track. The test in `lib/agent/agent.test.ts` checks business at 0.95 and 0.4 and personal at 0.3. Not deployed yet.

## Staff pages converted from the prototypes, 2026-10-29

- `pnpm sync:prototypes` now also generates `styles/generated/staff-admin.css` (from `admin.html`, scope `.pg-staff-admin`) and `console.css` (from `console.html`, scope `.pg-console`). Styles only: the views are React (`web/components/staff/`) over Clerk and Convex.
- `StaffShell` is the shared sidebar, breadcrumbs and phone drawer (inert background, Escape, scrim, focus back to the menu button). Signing out goes through Clerk.
- `/admin/users` uses `admin.html`'s page head, search and role filter, and `.tbl`. Columns: user, joined, last active, personalised-offers consent as a word, and role. The role is read-only on your own row and on the last admin, and promoting someone to admin asks once more. The server action also refuses to demote the last admin. Recent role changes appear as `admin.html`'s audit table.
- `/console/reviews` uses `console.html#reviews`: KPIs, open/closed chips and the queue, oldest first. `?case=<id>` opens a case page with total cost, the decision (approve with a rate and an optional fee waiver, or decline with a reason) and approval levels, followed by the win-rate tables. The decision rules are enforced in Convex.
- Prototype data that isn't in the backend is left out: the conversation, the competitor's rate and fees, band limits, "approve with conditions" and passing a case to someone else.
- `web/styles/admin.css` no longer has an importer.
- **Reviews layout, less repetitive:**
  - The queue has three counters: open, at or below your level, and oldest waiting. The lone type chip is gone, and the open/closed chips show counts.
  - The win rate stays below the queue: one headline row and one breakdown table with a group-by switch, plus "Why customers said no". Before any counter-offer it's a single empty state, not four empty cards.
  - Built in `console.html` first (`winRateHTML`, the `CO_WINRATE` mock), then synced.
- **Each staff area links only within itself**. "Back to chat" is a ghost button in the sidebar footer (`StaffShell`), not a nav row:
  - The links live in `web/lib/staff-nav.ts`, rendered by `components/staff/StaffNav.tsx` (`AdminNav`, `ConsoleNav`). `lib/staff-nav.test.ts` fails on a cross-area link.
  - `/admin` redirects to `/admin/users` and `/console` to `/console/reviews`. Logos and the first breadcrumb point at the area root.
  - `admin.html` drops Reviews and Counter-offers from "Later". Both prototypes put "Back to chat" above the signed-in person in `.me`.
  - Admins can still open the console by URL; role checks are unchanged.

## Negotiation and counter-offers on sample pricing (phase C1, policy `raiffy-agent@10`), 2026-10-29

- **Approved by the user:** risk bands, automatic counter-offers inside a pre-approved band and escalation, for the six synthetic customers only, labelled indicative and sample pricing. The SECCI upload (C2) is deferred.
- **Pure pricing** (`lib/pricing/`), following `docs/shared/pricing.md`:
  - `quote` gives the price without conditions, one line per condition with the cost of required products inside total and DAE, and the customer's own price. A valid personal offer overrides it; an expired one falls back to list pricing and says so.
  - `negotiate` compares total cost first, at the same amount and term. A typed claim gets no offer ("evidence needed"). The indicative affordability check (40% of income, from the sample rules) runs before any offer. Only customers with a risk view get the smallest lever combination inside their band: the fee waiver first, then the smallest margin cut in 5 bp steps. Otherwise the case escalates to the lowest level that can approve the gap. Offers are valid for the band's `validityDays` (7).
  - `profileFrom` reads only what the switches allow: the account switch gives salary, products, risk band, income and debts; savings gives deposits. A loan the product would refinance doesn't count against affordability.
- **Sample data** (`convex/seed/pricing.ts`, `pricing@1`): personal loan and mortgage rules, two bands and three sample competitor offers (Bank A, B, C). Every figure is labelled as sample data. The six personas reach the outcomes `pricing.md` expects: lowest price with "You already qualify"; list price with salary transfer as a lever; no counter-offer needed; a fee-waiver counter-offer; a mortgage escalated to a specialist; a small loan with no band.
- **Tools** (`convex/pricing.ts`):
  - `get_approved_offers` returns the quote. `negotiate_offer` is a new tool in `lib/agent/route.ts` and `prompt.ts`, on the negotiation and product_comparison routes. It returns the outcome as citable text with no band limits, needed cut or level. A test checks this.
  - Every outcome, including "not needed", goes to `counterOfferLogs`. Asking again within the validity returns the same offer and expiry.
  - Customer actions: `requestReview` (their own tap, only after an escalation) and `setOutcome` (simulated accept or decline, refused once expired). `myNegotiations` drives the card's status.
- **Operators** (`/console/reviews`, `components/console/ReviewQueue.tsx`):
  - The queue lists open cases with the cut needed. Each reviewer can decide only up to their approval level (`canApproveAt`: operators at specialist level, admins at any level).
  - An approved price becomes a `personalOffers` row ("Offer from Ana M., valid 7 days") that the next quote uses.
  - The win rate is accepted ÷ (band + escalated), by resolution, product, competitor and segment, with average gap, "not needed" and typed-claim counts. It's pseudonymous.
- **UI:** HTML-first in `chat.html` (`offerHTML`, scripted "Bank B offers less. Can you do better?"), then `OfferCard.tsx`. See `DESIGN.md` → Price and counter-offer card. `pnpm sync:prototypes` was rerun.
- **Tests:**
  - `lib/pricing/price.test.ts`: `evals/pricing-negotiation.json` PRICE-01..07 plus the `pricing.md` checks (conditional with unconditional, required-product cost in total and DAE, no offer on a claim, total cost first, inside the band and only with a risk view, validity, escalation level, ban-exact levers, affordability, "could be better", expired offers, no band details in the model text).
  - `convex/pricing.test.ts`: ownership, operator-only queue and KPI, approval levels, the same offer when asked again, simulated outcomes and expiry.
  - Suite: 576 lib and Convex tests, plus 44 web.
- **Not done:** the SECCI upload and customer confirmation (C2); competitor figures taken from real `competitor_docs` passages (the tool only uses the sample store offers); a link to `/console/reviews` from the chat; real outcomes from the official application flow. Nothing is deployed yet.

## Account data, synthetic (phase B), 2026-10-29

- **Sample accounts, labelled everywhere.** `convex/seed/demoPersonas.ts` has six synthetic customers matching `pricing.md` (long-time client, new client, competitor offer, cheaper competitor, mortgage refinance, small loan). `lib/expenses/synthetic.ts` generates their statements deterministically from a seed, so answers and tests repeat. None of it is a real account. The model text starts with "SAMPLE DATA", the card says "Sample data", and the panel says "Real accounts aren't connected in this preview".
- **"What Raiffy can see"** (`convex/accounts.ts`, table `accountAccess`, `web/components/agent/AccessPanel.tsx`): each signed-in user picks a sample account and turns on current account, savings and card transactions. Everything starts off, and nothing can be turned on without a sample account. Every function checks identity, and one user never sees another's choice. Business conversations get no account.
- **Pure aggregates** (`lib/expenses/summary.ts`): income, money out, debt payments, fees and balances; spending by category with the period before; subscriptions with price changes. Insight rules come from the "From Raiffy" cards 01–04 and 09 (overdraft cost, other banks' ATM fees, FX card fees, idle cash, subscriptions), with thresholds in `lib/expenses/rules.ts` (`insights@1`). A switched-off source is never read and is listed in `notUsed`.
- **`get_expense_summary`** is a host tool on the routes that list it (purchase goal, affordability, debt refinancing, saving goal, fees and statements, life event, cash shortfall, expense insights). It returns one citable summary of aggregates and category names only, with no merchants, IBANs or card numbers, at a `raiffy:account/...` address. Its figures pass the number check like any cited result. The trusted-route text now says account data comes only from this tool and must be called sample data.
- **Inputs:** with the account switch on, income and existing loan payments (3-month averages) fill the inputs gate as source `account`, below anything the customer says. `compare_routes` reads them as customer values.
- **Spending card:** HTML-first in `chat.html` (`spendingHTML`, scripted "Where does my money go?" turn), then `web/components/agent/SpendingCard.tsx`. The card is built by code and shown only when the answer cites the summary it comes from. It reuses the statement card's `.stmt`/`.line` and `.why` rows, with one lead total on `--tint-hl`. `raiffy:` sources render as chips and cites without a link.
- **Tests:** `lib/expenses/summary.test.ts` (aggregates, switches, the model-facing text, `evals/expense-insights.json` EXP-01..07) and `convex/accounts.test.ts` (off by default, sign-in, no switches without an account, isolation between users). The suite is at 526 lib and convex tests plus 44 web tests.
- **To see it live:** push the schema and functions (`pnpm exec convex dev --once`), then pick a sample account in the side panel and ask "Where does my money go?". Not pushed yet, because the push also deploys the other sessions' uncommitted work.

## Route recommendations: card and evals (phases 5 and 6), 2026-10-29

- **Card (phase 5)**: the live routes card in `web/components/agent/AnswerCards.tsx` already had the Recommended badge and the "Why I recommend" panel. The host-built card now fits it. `whenOther` no longer repeats "the choice is yours", which the panel adds. The recommended route's summary says what kind of route it is. A new optional `chosen` flag on routes (`lib/agent/blocks.ts`, `web/lib/agent-api.ts`) marks the customer's own route, and raiffy-0f renders it as a grey "Your choice" pill next to Recommended, also when they differ.
- **Answer check (phase 6)**: `lib/advice/check.ts` `checkAdviceAnswer` flags a final text that unconditionally recommends another route than the rule's pick, recommends while the rule waits for an input, claims eligibility or approval, or calls the simulation an offer. It's pattern-based, like the privacy screen. Cases: `evals/advice-answers.json` (ANS-01 to ANS-12), run by `lib/advice/check.test.ts` over the shared renovation fixture (`lib/advice/fixtures.ts`).
- **Live eval**: `pnpm advice:eval --live` (`scripts/eval-advice.ts`) runs LIVE-01 to LIVE-03 through `runAgent` with the real model and the fixture comparison as the `compare_routes` result. It scores the number check, one tool call and `checkAdviceAnswer`, and saves the answers to `evals/results/`. It needs `ANTHROPIC_API_KEY` in the shell. It hasn't been run yet.
- **Not done:** `checkAdviceAnswer` isn't enforced in the live loop yet. It runs in evals only, because a retry on it needs a check hook in `lib/rag/agent.ts`. The suite is at 519 passing.

## Route recommendations live in the chat (phases 3 and 4), 2026-10-29

- **`compare_routes`** (`convex/advice.ts`): a host tool, like raiffy-9b's `calculate_scenario`, offered only on a solution answer when the route allows the calculator. It checks the session first. Terms come from reviewed catalog records and the product's plan template, and customer figures from the conversation's inputs. The model's figures count only when the customer said them, defaults never count, and "no other loans" counts as zero. Timing is `now`, `can_wait` with a stated number of months, or `unknown`. The tool returns one citable comparison (`lib/advice/copy.ts`) and a routes card built from the same numbers. Without the customer's amount and term, or reviewed terms, it says what's missing and recommends nothing.
- **Card replacement** (`convex/agent.ts`, `lib/advice/copy.ts` `withHostRoutesCard`): the host-built routes card replaces any routes card the model makes, in both the card check and the fallback, so the recommendation is never model-written. The host card must pass the card check whole, or it isn't shown. The model's other card types are kept. A system sentence tells the model to call `compare_routes` for a goal and not to pick another route.
- **Debt share ceiling**: a new optional `debtShareCeilingTermId` on plan templates (`planTemplates`, `plans:setTemplate`). It's read only from a fresh, reviewed, exact eligibility term in basis points; otherwise there's no "room" claim.
- **Policy** `raiffy-agent@8`: an `advice` block (save first for 8 months, show save-only up to 24 months, another term 12 months shorter). Rebuilt with `pnpm agent:build-setup`.
- **Tests**: `lib/advice/copy.test.ts` and `tool.test` cases in it (12), and `convex/advice.test.ts` (8). The suite is at 500 passing. Under full parallel load, `convex/plans.test.ts`'s first test can hit the 5-second timeout; it passes alone.
- **Not done:** not deployed. A live recommendation still needs, in the catalog, a reviewed exact loan rate and a template set for the product. The "when do you need it" question has no input field yet (the model passes timing). There's no promptfoo eval of the live answer yet (phase 6). Raiffy's other notes in the trusted-route sentence ("No calculators … are connected") are raiffy-9b's to update.

## Route recommendations in `lib/advice` (phases 1 and 2), 2026-10-28

- **`buildRoutes`** (`lib/advice/routes.ts`): pure. Builds routes side by side from the customer's amount, term, income, other payments and monthly saving: the chosen loan, up to two other terms of it, the overdraft, save first then borrow less (over `saveFirstMonths`), and save only (up to `maxSaveOnlyMonths`). Every borrowing figure comes from raiffy-9b's `runScenario` (`lib/calc/scenario.ts`) over reviewed records; a route the catalog can't back is unavailable with its gaps. Saving routes count no interest on savings and don't use existing savings (labelled assumptions). A variable rate's affordability uses the stress-test payment.
- **`recommendRoute`** (`lib/advice/recommend.ts`): the agreed rule (hard limits, then timing, then cost, with near ties going to a fixed rate). The customer's term stands for its loan. Missing income or timing that would change the pick returns `needs_input`. Returns reason keys (checked against every route shown), trade-offs with differences in bani, the "better if it can wait" route, and the excluded routes with reasons. The debt share ceiling is an argument from a reviewed catalog term; without one, no "room" claim.
- **Tests**: `lib/advice/*.test.ts` (24), including the renovation example built end to end; `evals/advice-recommend.json` (ADV-01 to ADV-12) runs in the same tests. Rule written into `answer-patterns.md`.
- **Not done:** nothing calls it yet (phase 3 is the Convex tool handler, phase 4 the agent wiring with raiffy-0f); the "when do you need it" input, a reviewed savings rate and a stated debt share ceiling don't exist yet; the policy numbers (`saveFirstMonths`, `maxSaveOnlyMonths`, near-tie margin) still need a home in `lib/agent/config.ts`.

## Financial plans in Convex (phase 3), 2026-10-28

- **Tables** (`convex/schema.ts`): `planTemplates`, one per track and product, which names the catalog records behind a product's plan; `planSummaries`, one row per version, scoped by owner and organization like the conversation it belongs to.
- **`convex/plans.ts`**: `setTemplate` is admin only (`change.publish`), checks every term ID belongs to that product and track, and is audited. `create` authorizes the conversation first, then builds the plan with `buildPlan` from the catalog and template it reads itself, never from client figures. It returns the gaps and saves nothing when the catalog can't back the plan; each change is a new version of the same plan ID (at most 20), and a confirmation carries over as "changed". `get` and `listForThread` are owner only, and a plan that isn't yours looks the same as one that doesn't exist. Every stored plan is re-validated with `planSummarySchema` on read.
- **Tests**: `convex/plans.test.ts` (8).
- **Not done:** not deployed; the catalog import into cloud dev and the admin reviews still need to run (see `web/README.md`). Raiffeisen's personal-loan rate is a published range (5.55%–17.95%), so a live plan stays unavailable until a reviewed exact rate exists. The recommended route is the chosen one until phase 4 wires in the recommendation.

## Server calculators in the answer loop (policy `raiffy-agent@7`), 2026-10-28

- **`calculate_scenario`** (`lib/calc/scenario.ts`, pure): loan cost (monthly payment, total interest, fees, total payable, DAE via `repaymentSchedule`), overdraft cost (equal parts, yearly fee per started year, amount and term limits) and loan vs overdraft with the existing deterministic recommendation. Inputs are catalog term IDs, never values: every record is re-checked (fresh, quoted, reviewed, same product) with the plan builder's own `exactAmount`/`bounds`, so a scenario and a plan agree. A starting rate, ceiling, range, missing fee, promo rate or an amount or term outside the product's limits returns a gap. When the product has a plan template, its rate, counted fees and limits are used instead of the model's references. A variable rate gets a separate `stressTest` figure (+2 pp, `calculator.variableStressBps`), never shown as the rate. The amount and term are the customer's (a model-sent value counts only if the customer said it); a defaulted input makes the result an example.
- **Live wiring** (`convex/calculator.ts`, `lib/rag/tools.ts`, `HostTool` in `lib/rag/agent.ts`): the answer model now gets `get_product_terms` and `calculate_scenario` on routes that allow them, plus a list of catalog product IDs. Results come back as citable `search_result` blocks (`term:<termId>`, `calc:<n>`), so the existing citation and number checks accept a quoted calculation and reject an invented figure; unusable terms and gaps are a plain note. Trace: `terms.done`, `calc.done`.
- **Not in this phase:** the debt-to-income check (credit-decision features wait for approval); deposit real return (no inflation config). The cards don't take calculator figures directly yet.
- **Still needed for live figures:** push the schema, import the catalog seed and have an admin review terms (`markReviewed`). Until then both tools return "unavailable" and Raiffy keeps using dated public sources.
- Tests: `lib/calc/scenario.test.ts` (matches Raiffeisen's published example and `buildPlan` to the ban), `evals/calc-scenarios.json` (CALC-01 to CALC-09), `lib/rag/tools.test.ts`, a host-tool test in `lib/rag/agent.test.ts`. 474 lib and convex tests pass.

## Financial plan builder in `lib/plan` (phase 2), 2026-10-28

- **`lib/plan/schemas.ts`**: Zod `PlanSummary` in bani and basis points, versioned, with commission lines as keys (`charged`, `none`, `if_used`, `missing`), routes side by side (one chosen, exactly one recommended), affordability as a debt share in bps, assumption and gap notes as keys with params, every catalog value used as a source, the check status, and the handoff target. Also `PlanGap` and `BuildPlanResult`.
- **`buildPlan`** (`lib/plan/build.ts`): pure. A per-product template names which catalog records fill the rate, each commission line and the limits; every record is re-checked (fresh, quoted, reviewed, same product and track). It refuses, returning every gap at once, a starting rate ("de la"), a ceiling, a range, a variable rate, a charge counted in the total that the catalog doesn't confirm, a frequency mismatch, and an amount or term outside the product's limits. A conditional fee that isn't confirmed is listed as "Not confirmed", never zero. A confirmation of the previous version carries over as "changed after the check". `planInvariants` checks that the schedule adds up to the figures to the ban and that every template line is listed.
- **Tests**: `lib/plan/build.test.ts` (24), including Raiffeisen's published example (within 10 bani of 961.21 lei) and the chat prototype's plan to the ban. `evals/plan-build.json` (PLAN-01 to PLAN-14) is data-driven and runs in the same test. Spec schema updated in `plan-summary-handoff.md`.
- **Not done:** no product templates yet (they need reviewed term IDs), nothing calls `buildPlan` yet; phase 3 is `convex/plans.ts`.

## Financial plan prototypes (phase 1), 2026-10-28

- **Plan card** in `chat.html`: "Build my plan" on the simulator (or asking for a plan) builds a `PlanSummary` from the newest simulation in the chat: the goal, the chosen personal loan, monthly payment, total payable and DAE (labelled Estimate), the balance over time, where the rate and fees come from, the indicative label, a check status (Not checked, Being checked, Confirmed by, Changed after check) and "Open plan" / "Ask a specialist to check it". One plan per chat, versioned: a moved simulation shows "Update plan", the earlier card points to the newer version, and a confirmation given to an earlier version shows "Changed after the check". New flow for "What happens when I apply?".
- **`plan.html`** (`plan.html#PS-…`, later `/plan/[id]`): the full plan in SECCI order with three routes side by side (one recommended, with reasons and when another fits better), main features with sources, every commission including the ones that are none, affordability when the customer gave income, the schedule (6 rows, then all, with totals), assumptions, gaps, sources, and next steps (Apply in Smart Mobile as a labelled placeholder, ask a specialist, send to the Inbox (simulated), Download PDF through a print stylesheet). Without a saved plan it shows the example PS-2210 that matches the console's plan check R-1041.
- **Figures**: both pages mirror `lib/calc/schedule.ts` in bani and basis points; the chat plan for 8,000 lei over 24 months at 7.9% matches it to the ban (361.45 lei a month, 8,923.89 lei total).
- **Bridge** (demo only): plans are saved under `raiffy.demo.plans`. A plan check sent from the card or from `plan.html` reaches the console, which now shows the plan the customer saw (`fromSavedPlan`), and its automatic checks pass. The sign-off reaches the card and the page. Data from storage is validated and escaped.
- **Checked** in Chrome (Playwright script): no page errors in the build, check, sign, update and print flows; no horizontal scroll at 375px; the print view shows all rows and hides the actions. The booking and calendar flows still pass.
- **Next:** phase 2, `lib/plan/` (Zod `PlanSummary` and `buildPlan`, which refuses floor rates and unreviewed, stale or missing terms), then `convex/plans.ts`.

## Product terms catalog, schedule calculator and operator calendar prototypes, 2026-10-28

- **Catalog** (`lib/catalog/`): Zod `TermRecord` (exact, range, from, up_to, text, unavailable values; integer bps and bani), the quote verifier (`quote.ts`, a percentage matches only a percentage, every number in one chunk) and the `comparatie.csv` seed builder (`seed.ts`). `pnpm catalog:build-import` writes `productTerms.import.jsonl` (gitignored): 72 terms, 57 with the quote found, 6 stated missing, 9 not found (mostly BCR deposits). Every record starts unreviewed.
- **`get_product_terms`** (`lib/catalog/terms.ts`, `convex/catalog.ts`): fresh, quoted, reviewed values only; everything else comes back `unavailable` with a reason (stated missing, stale, quote not found, unreviewed, unknown product, not in catalog), never zero. Values are compared only when kind, unit and comparability key match. `markReviewed` needs `change.publish` (admin), refuses unquoted or missing values and writes `catalog.term_reviewed` to the audit log. Not offered to the live agent yet. Evals: `evals/catalog-terms.json` (CAT-01 to CAT-09).
- **Repayment schedule** (`lib/calc/schedule.ts`): annuity rows in bani with fees, the last instalment absorbs rounding, DAE by bisection. Checked against Raiffeisen's published example (961.21 lei a month).
- **Operator calendar** (`console.html#calendar`): week grid (agenda under 760px), open slots from weekly hours, breaks, days off, a daily cap, lead time and buffers; the availability sheet warns about booked meetings outside new hours; the meeting sheet opens the shared summary only from 15 minutes before to 24 hours after, logs every opening, and handles join, done, no-show (two pause bookings for 30 days), cancel with a note, and pause (admin only, operators send it to an admin). Unconfirmed meetings are released 24 hours before.
- **Booking card** (`chat.html`, documents and specialist answers): one call per customer, four slots, video or phone, an unticked summary-sharing checkbox with "See what's sent", and scope and anti-fraud notes. Investment questions point to a licensed adviser and offer no booking. The two pages share bookings, slots and cancellations in both directions through `raiffy.demo.*` localStorage keys (demo only); data from storage is validated and escaped.
- **Checked** in Chrome (Playwright script, `/browse` would not stay up on this machine): no page errors, a chat booking appears in the console, cancellations sync both ways, no horizontal scroll at 375px.
- **Not done:** `productTerms` schema not pushed and the seed not imported (`pnpm exec convex dev --once`, `pnpm catalog:build-import`, `pnpm exec convex import --table productTerms --replace -y productTerms.import.jsonl`); no records reviewed; no Convex bookings table, real reminders or video links yet.

## Answer cards in the live chat, 2026-10-28

- The live chat now renders cards: comparison table, routes with one recommendation, key facts, checklist and adviser handoff. Claude fills them as JSON through a `show_cards` tool (`lib/agent/blocks.ts`); `/chat` renders them with the demo card markup (`web/components/agent/AnswerCards.tsx`, CSS in `web/styles/agent.css`).
- Deviation from "numbers never come from the LLM", approved by the user for this step: Claude transcribes figures, it never computes them. Each figure must appear in the search result it cites (same check as the text) or be the customer's own figure; unsupported facts are dropped and logged (`cards.checked` / `cards.rejected` in the trace). Simulations and totals still need the catalog and calculators.
- Layout fix: fact values are capped at 48 characters, one figure each, in English (context in the label); routes stack as rows when there are three or four (chat.html `.saves`), with label-above-value figures (`.plan-figs`); fact rows wrap instead of overlapping. The card instructions also keep routes on the customer's purpose (refinancing only when they mention existing loans).
- Tests: `lib/agent/blocks.test.ts`, a cards test in `lib/rag/agent.test.ts`. Visual check at 900px and 375px with sample data. Not yet seen with a live answer.

## Customer figures, euro amounts and solution recommendations (policy `raiffy-agent@6`), 2026-10-28

- Found with the trace: "a credit of 50k euro" searched and found sources, then failed the number check twice (`ungroundedNumbers: ["50","50"]`) because the answer repeated the customer's own "50k", and was replaced by the unavailable message. The second Raiffeisen search was also denied (5-passage budget used).
- `checkNumbers` now accepts `customerFigures`: stated amounts, terms and payments plus the short form the customer wrote, never rates and never derived figures (`customerAllowedFigures`). The "Can I get 7.10%?" protection is unchanged.
- Euro amounts: never converted; the model says when the sources show only lei products and uses the same number in lei as a labelled example, with an adviser to confirm euro options.
- Solution scope: 9 passages instead of 5, at least three routes, and one recommendation by fit (purpose, amount, term against sourced conditions), with why and when another route fits better. Not an approval or offer.
- Trace: new `model.figures` line (count of customer figures, euro, scope). Not yet verified with a live message.

## "Other" no longer swallows loan requests (policy `raiffy-agent@4`), 2026-10-28

- Found with the trace: "i want to take a credit of 50k euro" came back from Jev as `other` 0.92, because `other` covered "the purpose is unclear", and a confident `other` went straight to the generic question with no fallback and no retrieval.
- Jev's `purchase_goal` now covers any borrowing or financing request, including an amount without a purpose; `other` excludes requests to borrow, save, pay or open a product. Policy bumped to `raiffy-agent@4` (label wording changes the distributions).
- Safety net: `bankingIntent` in `lib/agent/confidence.ts` (EN/RO keywords). When Jev says `other` but the message clearly asks for a banking product, the hinted patterns go to the Haiku fallback, then to chips. Any remaining `other` offers chips from Jev's top labels instead of the open question.
- `/chat` no longer calls `agent:run` twice per message (the resume effect skipped replies this tab started).
- 6 new routing cases (54). The live routing eval has not been re-run against the new label wording.

## Backend message trace, 2026-10-28

- `convex/trace.ts` logs each step of one message through the backend, tagged `[raiffy <messageId>]`: `message.received`, `run.start`, `privacy.screen`, `state.loaded`, `jev.classify` (top 3 patterns, risk scores, or why Jev was unavailable), `route.decided`, `fallback.pattern`, `inputs.extracted`, `jev.slots`, `fallback.slots`, `inputs.gate`, `model.start`, `model.call#n` (stop reason, tokens), `search.call` / `search.denied` / `search.done`, `rag.embed`, `rag.vector` (hits, top scores), `rag.keyword`, `rag.ranked` (top chunks with bank, section, score), `knowledge.result`, `answer.checked`, `run.done`, and `run (at <step>) FAILED` with the error (previously swallowed).
- Off by default. Dev only: `pnpm exec convex env set RAIFFY_TRACE true`; add `RAIFFY_TRACE_TEXT true` to include the screened question and search queries. Read with `pnpm exec convex logs`, the `convex dev` terminal or the dashboard. Lines carry ids, labels, counts, scores and timings, never account data.
- `model.call#n` and the `rag.*` lines run only against the real deployment (tests mock the model loop and search); the rest is exercised by `convex/agent.test.ts` with `RAIFFY_TRACE=true ... --silent=false`.

## Pattern confidence and required inputs (policy `raiffy-agent@3`), 2026-10-28

- **Routing** (`lib/agent/confidence.ts`, `route.ts`): only the pattern needs confidence now. Route on the label's floor (`perInquiry`, default 0.8) or a 0.35 lead over the runner-up; if the top two need the same required inputs, route and let the inputs request settle it; otherwise a small Haiku call (`convex/fallbackModel.ts`, `claude-haiku-5-5`, structured output limited to the candidate labels) picks one or says unsure; still undecided, Raiffy offers a chip per candidate. An unsure scope follows from the pattern, an unsure complexity uses the stronger model. Risk checks still run first on every message.
- **Conversation state** (`lib/agent/state.ts`, `ragThreads.agentState`): pattern, the customer's inputs with their source, a pending inputs request and the choices offered. Jev's `recentContext` is now a structured summary plus the last two turns, and a new `answers_pending` question keeps the pattern when a message answers Raiffy's question.
- **Inputs** (`lib/agent/inputs.ts`): required and optional inputs per pattern (`answer-patterns.md` → Inputs per pattern), an EN/RO parser for amounts, terms and rates, keyword choices, then a Jev slot request and the Haiku fallback for choices it misses. Missing required inputs get one `inputs_request` card (at most 3 fields, at most 2 rounds, a "Skip, show typical examples" reply) without calling the answer model. The answer model then gets every input with its value or null and its source. Customer-stated figures may be repeated back without tripping the catalog check.
- **UI**: the inputs card is in `chat.html` (affordability question in the scripted demo) and in `/chat` (`InputsCard` in `AgentChat.tsx`); choice and skip replies go to `agent:send` as `reply`, accepted only for what was offered.
- **Evals**: `evals/agent-inputs.json` (28 cases, run by `lib/agent/inputs.test.ts`), 22 new routing cases in `evals/agent-routing.json` (48 total), and `pnpm agent:eval-routing --live | --replay <file>` to record Jev's distributions and re-score thresholds without new calls. No live Jev run yet, so thresholds remain provisional.
- **Not done:** the schema changes (`agentState`, `reply`) are not pushed to the cloud dev deployment; routing metrics are not in `admin.html` Analytics yet; account data and memory don't fill inputs yet because neither is connected.

## Playwright e2e disabled, 2026-10-28

- `web/` Playwright specs are turned off: `pnpm test:e2e` prints a notice, and `web/playwright.config.ts` ignores every spec (`testIgnore: "**/*"`). The `e2e/` files, `@playwright/test` and the config stay, so re-enabling is a small revert (see `web/README.md`). The opt-in paid cloud test (`RAIFFY_LIVE_AGENT_TEST=1 node scripts/test-agent-cloud.mjs`) is unchanged and still behind its flag. Unit tests (Vitest) and evals are unaffected.

## Demo fixes, 2026-10-29

- **Jev `invalid_response`:** the parser rejected rounded distributions. Over 14 labels, two-decimal rounding can sum to 0.97 or 1.03, past the old 0.01 limit, and labels at 0 may be omitted. The tolerance now scales with the label count (`lib/agent/jev.ts`), missing labels count as 0, the distribution is normalized and confidence recomputed. Invented labels, a non-maximal choice or larger errors are still rejected. A rejected reply logs only the failing field paths (`jev_invalid_response`), and `agent:run` retries once after `invalid_response` or `provider_error` (not after a timeout).
- **Follow-up chips:** they now name the product or route (`followUps` in `lib/agent/composer.ts`): "Which documents do I need for Flexicredit?", "Compare X with Y for my situation". Without a named Raiffeisen product there are no chips, instead of generic ones Jev couldn't route.
- **Customer figures:** the customer's own messages and confirmed memories are passed as `customerStatements`. Their figures (age, income, amount, term) no longer trigger the number or price retry or the final catalog check, and the retry notes say to keep them and still state plainly whether the customer meets a condition. Document prices stay withheld (`rag-agent@11`).
- **Book an adviser:** answers about loans, comparisons and offers, complaints, hardship, fraud and unverifiable answers carry a handoff action (`lib/agent/handoff.ts`). The button first shows exactly what the adviser receives (the customer's last six messages, screened again), and "Send request" records a `handoffRequests` row with a reference (`convex/handoff.ts`). The status stays "requested"; no adviser queue is connected, and the UI says so. Complaints now get this path instead of the generic unavailable text.
- **Docker:** `web/Dockerfile` (the app), root `Dockerfile` (tests and type checks), `docker-compose.yml` with `web`, `checks` and a `deploy` profile that pushes the functions to the deployment of `CONVEX_DEPLOY_KEY`. `convex/_generated/` is now committed, as Convex recommends, so a fresh clone or container can test without a deployment. Docker wasn't available on the authoring machine: the web production build and every check passed outside Docker, the images themselves weren't built.
- **Repo hygiene:** removed the two spec zips and `.gstack/` logs from git; `.gitignore` now covers archives, logs, macOS `._*` files and `.claude/worktrees/`; `.github/pull_request_template.md` has the pre-PR checklist. Fixed the unfilled `esbuild` build approval in `web/pnpm-workspace.yaml` that made every web install exit with an error.
- Validation: 257 backend tests, root and Convex type checks, agent setup check; web 20 tests, type check, lint and production build. Not deployed: nothing was pushed to the shared dev deployment.

## Live chat testing: routing and retry fixes, 2026-10-28

- **Finding:** after the first answer, almost every live question got the generic clarify reply. Stored routing data in `ragMessages` showed Jev was confident about the inquiry (for example `saving_goal` 1.00, `product_explanation` 0.99, `affordability` 0.97) but below the 0.8 floor on scope or complexity (complexity 0.06 for "I want to save up 10k euros", 0.78 for "How do Raiffeisen term deposits work…"). For a two-label choice, 0.8 means a 90% probability, so the simple/complex call blocked answers it only uses to pick a model.
- **Fix** (`lib/agent/route.ts`): only inquiry confidence below the floor clarifies. Uncertain complexity routes to the orchestrator and the stronger model; uncertain scope sets `scope: null`. Risk, track, memory and multi-goal gates are unchanged.
- **Fix** (`lib/rag/prompt.ts`, `rag-agent@5`): retry notes are sent as a user turn, so Claude answered them to the customer ("Those two numbers came from your message…") and that text was published. Every retry note now ends with `RETRY_REWRITE_NOTE`: it comes from an automated check, and the reply is the corrected answer only.
- Tests: 214 pass; root and Convex type checks pass. Four live questions added to `evals/agent-routing.json`. Pushed to cloud dev `diligent-rhinoceros-830`.
- **Second fix, local only (not live):** an uncertain or unmatched inquiry now reaches Claude with public documents only instead of the canned clarify text; uncertain goal count uses orchestration; an uncertain audience keeps the session's track; an uncertain memory request without the memory handler gets the memory-not-enabled reply. Risk gates are unchanged. 216 tests pass. It was pushed at 21:21 (local time) but overwritten within minutes: **another machine deploys a different, unpublished version to the same dev deployment** (it adds `users:*`, `audit:list`, `agent:saveState` and routes like `collect_inputs` / `ambiguous_inquiry`). Each push replaces the other's functions. Coordinate deployments before pushing again.
- **Local acceptance of the second fix** (temporary local Convex deployment `local-andrei_cazacu-raiffy`, same 9,334 chunks re-embedded, synthetic Clerk user, real Jev/Claude): 8 of 10 persona questions answered usefully, including two low-confidence follow-ups, a Raiffeisen/BCR comparison, a greeting and an honest memory-not-enabled reply. Still failing: a term-deposit explanation (Claude quoted figures, so the whole answer was replaced by the catalog notice; there is no retry for that check) and a fee complaint (`security_complaint` has no connected handoff, so it gets the generic unavailable text). Cross-chat memory is off by design, so a new chat does not know the customer.
- **Third fix, local only (`rag-agent@6`):** RAG data and search were fine; product answers were lost after generation. (1) `containsFinancialFigure` moved to `lib/rag/numbers.ts`; with `withholdFinancialFigures` the agent loop now asks once for a rewrite without rates, fees or amounts (`retryNoteForFinancialFigures`), and the Convex catalog check stays as the final guard. (2) The 5-passage budget let the first `bank_product_docs` search (mostly T&C PDFs) take every slot, so a `banking_help` search returned `unavailable`; product questions now reserve 2 passages for the product pages' FAQs, as comparisons already did for the other bank, and the prompt says to search both. Local run: term deposits, Flexidepozit, savings account and credit card all answered (each after one price rewrite, 3 + 2 passages, sourced); the car question still answers. 220 tests pass. Note: the base prompt still says to keep amounts and percentages exactly as they appear, which is why every first draft quotes prices and costs a retry.
- **Fourth fix, local only (`rag-agent@7`): answers showed one option.** Three causes: (1) the answer-scope rule from `answer-patterns.md` never reached Claude, and the base prompt's "two to four sentences, no lists" ruled out side-by-side routes; `answerScopeNote(plan.scope)` now goes into the route note (solution: at least three routes including not borrowing, one recommended, one search per route by product name; compare: exactly the named options; detail: name each variant in the results). (2) The first search took the whole 5-passage budget, and the competitor reservation applied to every comparison, so a same-bank comparison got 0 passages for its second option; searches are now capped at 2 (solution) or 3 (compare), competitor space is reserved only when the customer names another bank, and FAQ space only outside solution/compare. (3) Low page diversity (2.2–2.5 distinct pages in the top 5); `diversifyByPage` lets no page take more than half the slots. Local eval with the same data as cloud: distinct pages 2.18→2.89 (competitors) and 2.45→3.24 (legacy), page@5 84→86% and 89→91%, but exact-passage hit@5 66→59% and 87→82% because a page's third chunk now gives way to another page; isolation 21/21, 0 violations. Team decision: keep, soften (cap = half rounded up) or drop the per-page cap. Live local: car goal → 4 routes with a recommendation; emergency savings → 4 routes; overdraft vs personal loan → both, recommended one; term deposits → Flexidepozit, Fresh Money and LEI/EUR/USD deposits. 225 tests pass. The figure guard misses limits written without a currency ("up to 6 net salaries").
- **Fifth change, local only (`rag-agent@8`): answer formatting and route cards.** The live chat rendered every answer as one plain `<p>` (raw `**`, "- " lines) and ignored `ui.blocks`. Now `web/lib/answer-view.ts` renders bold and bullets while keeping citations and the word reveal, and for `solution`/`compare` scopes `lib/agent/routes.ts` reshapes the checked answer's route list (fixed form from `answerScopeNote`: "- **Name** (recommended) — what it is. Main risk: …. Why: …") into a `routes` block that `RouteCards` shows in place of the list. Cards carry no figures ("Exact cost · Not verified here") and add nothing the checked text doesn't say. **Agreed deviation** from answer-schema.md ("the LLM never builds blocks") and DESIGN.md (recommendation rule in code) until the catalog and calculators are connected; noted in DESIGN.md. Live local: car goal 4 cards (one recommended), emergency savings 4, overdraft vs loan 2, term deposits no cards (detail) with formatted text. Desktop and 375px screenshots checked, no overflow or page errors. Root 229 tests, web 20 tests, web typecheck and lint pass. The "dated public information" notice still joins the last paragraph because the notice segment starts with a space.
- **Sixth change, local only (`rag-agent@9`): indicative loan affordability.** "Am I eligible for 50,000 lei over 60 months on 4,500 lei?" got no concrete answer: no calculator was connected, and the figure guard blocked even the customer's own numbers. Now: `lib/calc/affordability.ts` (BNR debt-service limit, highest annual rate at which the loan still fits, so no product rate is needed; term and age-at-end checks); `lib/agent/calculator.ts` runs it only on figures the customer wrote in the conversation (an unstated income is refused, so the model asks for it); `calculate_scenario` contract updated to `loan_affordability` with explicit fields; calculator results are trusted text for `checkNumbers` and the figure guard (`unsupportedFinancialFigures`), while document prices stay blocked and customer-stated numbers alone still don't count; the uncertain-inquiry route also gets the calculator. Limits live in Convex `regulatoryLimits`, imported from `catalog/regulatory-limits.jsonl`: 40% RON, 20% FX, 60-month consumer term, all **pending_review** with a placeholder `bnr.ro` link; someone must confirm the values and the exact regulation link. Live local: Ana's Romanian question → within the limit (max 1,800 lei/month, 833 lei with no interest, fits up to 35.8%, age 34 at the end), in English; no income given → asks for it; 2,000 lei with a 500 lei instalment → doesn't fit; 84 months → over the term limit. 239 tests pass. Not covered: worded or "50k" amounts (the spec's deterministic amount parser), joint incomes, first-home +5 pp, the stress scenario, and an affordability UI block.
- **Seventh change, local only (`rag-agent@10`): customer memory with consent.** The store in `convex/memory.ts` (propose with quote check and screening, confirm, reject, list, forget, expiry) was built but writes only worked for a pinned demo persona. Now: (1) gate — signed-in customers can write only where `RAIFFY_MEMORY_WRITES_ENABLED=true` and `RAIFFY_MEMORY_WRITES_DEPLOYMENT_URL` equals the deployment's own URL (`customerMemoryWritesEnabled`), so a copied flag can't enable another deployment; set **only on the local backend**, cloud stays off until the team decides. (2) Pipeline — each customer message is recorded as a screened memory source; `propose_memory_change` (contract narrowed to `kind`, `text`, `customerQuote`; the host attaches the message, and `text` must be the customer's verbatim words) queues proposals; saved memories reach Claude as a dated system note (`memoryContextNote`) and count as customer statements for the calculator; "what do you remember?" and "forget…" are answered from the store, and deletion stays a click in the panel. (3) UI — a "Remember this for next time?" card under the answer (Remember / Not now) and "What Raiffy remembers" in Context with per-item and full deletion. Two classifier findings fixed: Jev's single-choice memory candidate split its probability across goal + figure + preference (top confidence 0.30), so its score now ranks but no longer gates proposals; and `special_category` asked whether a message "mentions health", which flagged "I work as a nurse", so it now asks about health conditions or treatment and says a job or income alone is none (0.03 after the change). Live local: chat 1 → goal and preference proposed verbatim and saved; chat 2 → "As you told me, you want to buy a used car next year and prefer a fixed monthly payment"; after saving income, a new chat ran the affordability check without asking for it again; "What do you remember about me?" lists the items with dates. Desktop and 375px checked. 246 tests pass.
- **Still open:** the generic follow-up chips ("What conditions should I check?", "Which official documents should I read?") don't name the product, so Jev can't route them (inquiry 0.46–0.73); an uncertain memory question ("do you remember my age?") gets the generic clarify text instead of the memory-not-enabled reply; one Jev call returned `invalid_response`; customer-stated amounts (10,000 EUR, 5,000 lei) trigger the number retry, and the rewritten answer dropped the customer's figures, including their age, so it never said plainly that 20 is below the minimum age of 21.

## Live UI → Jev → agent → RAG, 2026-10-28

- Integrated retrieval commit `f29e082` with current main (`e8dac1d`) in a separate checkout. Existing voice/demo-profile changes in other checkouts were preserved. Reused the live chat frontend from `ui/agent-chat` with new auth and pipeline contracts; its older unauthenticated backend was not adopted.
- `/chat` now uses real Clerk authentication, a `convex` JWT template and owner-scoped cloud functions. A claimable development Clerk app was provisioned for synthetic testing; local private keys/claim files are ignored. Its issuer is configured in cloud Convex. Claim/setup instructions are in `web/README.md`.
- `agent:send` screens input before storage, derives scope from verified identity, rate-limits per owner, and allocates the reply. `agent:run` starts each request once under that identity, runs live Jev, applies risk/confidence/track gates and restricts Claude to the planned public collections. Cancellation, history and every thread operation enforce ownership. Private memory writes remain off.
- Claude receives only bounded, screened history and allowed tool results. A five-passage budget reserves evidence from both bank collections for comparisons. Completed answers pass existing citation/number checks before publication; checked text then reveals word by word. Code composes the UI envelope, follow-ups, disclosure and source-date presentation. Unchecked/truncated answers are withheld. Collection-date prose was removed from the model prompt to avoid failing the numeric guard on metadata; prompt version is `rag-agent@4`.
- Read-only cloud audit: **9,334 chunks, all embedded, zero scope violations**. Earlier empty-cloud observations below are historical. Offline checks validate all 72 competitor/coverage cases, 21 isolation cases and 82 legacy cases against the source data. Live isolation: **21/21**. Broader competitor exact-passage hit@5 is **66%** (70 hit cases; English 64%, Romanian 78%); page@5 is 84%, and coverage checks are 2/2. This is below the retrieval plan's acceptance target; successful live examples are not a full quality acceptance.
- Real Chrome/cloud acceptance passed: sourced personal-loan document answer, contextual follow-up, Raiffeisen/BCR comparison citing both banks, fraud override without Claude, persistent history after reload, anonymous access denied, and no mobile overflow. Observed sourced-answer samples were roughly 6–9 seconds to backend completion and 9–14 seconds including checked word reveal; fraud about 1–2 seconds. These are samples, not latency guarantees. Private results/screenshots are under `.convex/acceptance/`.
- Validation: 213 backend tests and root/Convex type checks pass; web has 17 passing unit tests, scoped lint/type checks and a production build. Live tests use synthetic accounts and real providers; ordinary unit tests mock providers. Exact financial figures are withheld until a reviewed catalog is connected, even if they appear in a retrieved passage.
- Remaining product capabilities are explicit gaps: reviewed `productTerms` catalog/lookup and exact financial comparisons, deterministic calculator/expense tools, authorized offer negotiation/adviser booking, broader retrieval/classifier evaluation, real-user privacy/consent acceptance and memory retrieval/confirmation UI. These are not advertised as connected by the capability registry. The current live milestone is authenticated, sourced public-product Q&A and factual document comparisons.

## Task 2: search_knowledge handler and retrieval evals 2026-10-28

- **Handler** on Denis's contract (`lib/agent/prompt.ts`): `convex/knowledge.ts` checks the identity first; the pure part is `lib/rag/knowledge.ts`. Output: `{status: ok|unavailable, collection, passages[{passageId, bank, product, productId, sectionType, docType, text, provenance, score}], coverage{requested, returned, gaps}, reason?}`.
  - Stale passages are left out and counted as `stale_excluded`. If every passage is stale, the result is `unavailable` with `stale_sources`.
  - Gaps: `no_results`, `fewer_results_than_requested`, `stale_excluded`, `fees_in_shared_tariff_pdfs`, `ing_pdfs_not_collected`.
  - `user_memory` returns `unavailable` (`collection_not_connected`) and unknown collections return `unknown_collection`. Neither searches, and neither falls back to another collection.
- **Agent** (`lib/rag/agent.ts`, `convex/agent.ts`) now uses Denis's tool definition. Prompt `rag-agent@3` says which collection to pick; coverage gaps reach Claude as a separate system note.
- **Evals**, run with `pnpm rag:eval` (`--offline` checks every expected passage against `chunks.jsonl`; `--audit` checks every stored chunk). Scoring is in `lib/rag/evaluation.ts`; every case fails on any out-of-scope passage.
  - `evals/retrieval-competitors.json`: 70 hit cases from `comparatie.csv` (61 English, 9 Romanian) and 2 coverage cases. Raiffeisen rows search `bank_product_docs`; ING and BCR rows search `competitor_docs`.
  - `evals/retrieval-isolation.json`: 21 adversarial cases (business queries on personal and the reverse, corporate, cross-collection, FAQ-only, `user_memory`, unknown collection).
  - The 82 legacy Raiffeisen cases run as `bank_product_docs` hit cases.
- `retrievalEval:run` is internal (deploy key only). The Convex CLI can't act as a user on internal functions, so it calls the handler without the identity check (`searchKnowledgeForTrack`, `hybridSearch`). The identity check has its own tests in `convex/knowledge.test.ts`.
- **Cloud dev:** `.env.local` selected the local anonymous backend again; it now selects `diligent-rhinoceros-830` (EU West). Pushed the functions, imported the 9,334 chunks into the empty `ragChunks` table and embedded them all. The push also removed the indexes `demoRuns.by_profile` and `demoProfiles.by_profile`: those two tables aren't in our schema or git history. Their data is kept.
- **Results** (live, top 5):

  | Set | hit@1 | hit@5 | Right page in top 5 | MRR |
  | --- | --- | --- | --- | --- |
  | Competitors (70) | 29% | 61% | 90% | 0.40 |
  | Legacy Raiffeisen (82) | 40% | 79% | 87% | 0.55 |

  Isolation: 21/21 pass. Coverage: 2/2. No out-of-scope passage in any set. Data audit: 9,334 chunks, 0 violations.
- **Finding:** most competitor misses return the right page but another chunk of it. The main cases are BCR deposit rates in a PDF table, and the Casa Ta and ING mortgage conditions. Options to decide together: one passage per page in the top 5, more candidates, or chunk-level boosts.
- Validation: 173 Vitest tests pass; root and Convex type checks are clean.

## Retrieval merge review 2026-10-28

- PR #6 is merged into `main` at `4ff485b`, including retrieval commit `caf9614` and conflict-resolution merge `a747345`. Removed the obsolete `visibilityField` import left in `convex/rag.ts`; it caused the merged Convex TypeScript check to fail.
- Authentication remains in the shared `searchChunks` path before embedding/search calls. Memory tables, thread ownership, citation checks, incomplete-answer rejection and private-persistence gates are preserved.
- Rebuilt the import locally: 9,334 eligible documents; 37 withdrawn and 729 out-of-scope chunks excluded. Collection/track counts match Andrei's handoff. The generated file is ignored under `.convex/acceptance/`; it was not imported or embedded during this review.
- Read-only check of the configured cloud dev target (`andrei-cazacu:raiffy:dev/andrei-cazacu`, `diligent-rhinoceros-830`) found **no `ragChunks` rows**. The handoff's imported/embedded corpus is not present in this deployment. Transfer/import and embedding verification are required here before live retrieval acceptance; no running deployment or customer data was changed during this review.
- Validation: root and Convex TypeScript checks, generated agent setup consistency and diff whitespace checks pass. No unit suite or paid provider calls rerun. Task 2 steps 2–6 remain unfinished: scoped tool handler, reviewed structured catalog and terms lookup, competitor/catalog/isolation evals, and English retrieval improvement. Then connect the Jev route plan, composer and app for chatbot acceptance.

## Backend integration review 2026-10-28

- Combined local memory/Jev work with teammate PR #4 (already merged into main at `2bb0b37`). Preserved memory/provenance tables and added RAG threads plus 1536-dimensional OpenAI embeddings from the PR. UI source was identical to main and was not rewritten; the raw competitor package and design references remain outside this source commit.
- Closed unauthenticated paid agent/search entry points and enforced user/organization ownership on every thread path. Legacy unowned threads fail closed. Capped history and message reads.
- Bound numeric presence checks to valid cited fragments, rejected invalid citations and truncated model replies, and made exhausted-loop fallback schema-valid. Semantic financial fact validation remains open.
- Read-only cloud audit verified the three provider-key names are set, public RAG and memory tables are empty, and the running deployment initially used the earlier public-product action. Deployed the tested merged backend to the same cloud dev target; verified `agent:ask` and `rag:search` reject unauthenticated calls. No provider calls or corpus embedding were run for this assessment.
- Validation: 138 backend tests and root/Convex type checks pass; generated setup is consistent. The separate `ui/agent-chat` streaming branch remains unmerged and must retain the new ownership guards.
- Current status and shortest path to in-app testing: `raiffy-spec/docs/plans/backend-integration-status.md`. The live UI, Clerk/PII pipeline, Jev-to-answer connection, combined-bank importer, structured calculators/catalog/offers and real-user memory acceptance remain unfinished.

## Memory store and Jev transport 2026-10-28

- Owner approved a dev-only synthetic identity and confirmed that everyone uses cloud Convex. Implemented `memoryProposals`, `userMemories` and minimal masked conversation/message provenance in Convex, separate from public RAG. Ownership is derived server-side; organization scope comes from signed identity claims. The demo identity is personal-only and requires explicit flags plus an exact pin to the MCP-verified cloud dev URL and matching site URL. Production/other deployments reject copied flags; real-customer writes remain disabled.
- Internal proposal validation checks an exact stored quote and requires proposed text to be an excerpt. Customer `confirm`, `reject`, `listMine`, `forgetOne` and `forgetAll` enforce scope. Confirm retries are idempotent; corrections replace atomically; deletion clears consent/pending updates and revokes source eligibility. No memory embeddings or private caches exist.
- Configured synthetic-demo retention: financial statements 90 days, constraints 180, goals/preferences 365, pending proposals 7 and source provenance 30. Dates run from the statement, not confirmation. Reads exclude expired rows immediately; an hourly cron deletes in bounded batches. The pattern-based demo privacy screen is not a complete privacy pipeline; production persistence stays off.
- Added internal stored-source Jev action and server transport pinned to `jev-1.14.0`: 2500 ms total deadline, 64 KiB response cap, validated output, no automatic retry or provider fallback. `RAIFFY_JEV_ENABLED` defaults off. No live Jev call, measured accuracy or threshold calibration.
- Authenticated the Convex MCP using this machine's saved Convex login and registered it in Codex as `convex`. Verified dev `diligent-rhinoceros-830` in EU West (`andrei-cazacu:raiffy:dev/andrei-cazacu`). Stopped the previous local dev process; `.env.local` selects cloud dev. New root guidance explicitly excludes anonymous/local backends.
- Added `convex-test` lifecycle and transport fault tests, `evals/memory-store.json`, `evals/jev-transport.json`, `pnpm convex:typecheck`, and the cloud dev `pnpm memory:check-mcp` check. Published the updated functions to cloud dev. Through MCP, verified tables, a synthetic proposal, customer confirmation, idempotent re-confirmation and deletion; restored the original demo settings and deployment pin afterward. No pre-existing demo memories were deleted.
- Validation: 107 Vitest tests pass; root and Convex TypeScript checks, generated setup consistency, and diff whitespace checks pass. Live cloud MCP memory lifecycle check passes. Jev tests use mocked transport only; no live provider calls.
- Jev-to-RAG orchestration, UI confirmation, real Clerk/PII integration, structured catalog/comparison and approved offers remain next. Source checkpoint preserved in commit `9c94852`; combined with PR #4 during backend integration.

## Agent foundation update 2026-10-28

- Refreshed backend through `e480df3`. Added pure TypeScript Jev request/response contracts, deterministic routing, model policy and memory retrieval boundaries in `lib/agent/`.
- The current owner request adds **TypeSafe Jev for inquiry classification**, while Claude remains the generator. This is separate from the previously rejected Jev Router gateway below.
- Generated console-style setup is in `agents/raiffy.agent.yaml`; request and policy examples sit alongside it. Regenerate with `pnpm agent:build-setup`; check with `pnpm agent:check-setup`.
- Setup guide: `raiffy-spec/docs/plans/agent-foundation.md`. Initial assumptions are the existing Convex/Messages API runtime and memory proposals confirmed by the customer (see the memory candidates entry below). Sonnet remains the default; optional Opus escalation is disabled.
- Tool declarations remain unwired to the full agent loop. The later local memory/transport implementation is recorded above; no real auth/PII adapter, expense connection, competitor collection or private memory persistence is enabled. The existing public-product RAG action remains separate.
- Added labeled EN/RO routing examples under `evals/agent-routing.json`. These are not measured Jev results. Confidence thresholds are provisional and need calibration.
- Validation: generated setup matches its sources; TypeScript checks pass. Unit tests cover routing, risk overrides, capability checks and memory isolation. No live provider or in-app acceptance run yet.
- **Memory candidates from Jev (policy `raiffy-agent@2`).** Jev now also asks what the customer stated about themselves (`memory_candidate`: goal, preference, constraint, stated figure), whether it is durable and whether the message has special-category or third-party details. `scoreMemoryCandidate` in `lib/agent/memory.ts` accepts a candidate when P(kind) × P(durable) ≥ 0.6 and no risk, special-category or explicit memory operation applies. The route planner then adds `propose_memory_change` to the normal answer without changing the handler or model. The customer confirms every memory; persistence stays disabled. Thresholds are provisional; new labeled cases are in `evals/agent-routing.json`.

## Task 2: retrieval and catalog (Andrei), 2026-10-28

- Plan agreed: `raiffy-spec/docs/plans/retrieval.md`. It uses Denis's architecture and contracts (`search_knowledge`, `get_product_terms`), OpenAI embeddings, `banks-data-package/` as the single data source (Raiffeisen, ING, BCR) and `comparatie.csv` as the catalog seed.
- Added `banks-data-package/` (10,100 chunks, snapshot 2026-10-28). Scope rule confirmed: tools get their scope only from a server-side `resolveScope`; Denis's auth work (task 1) plugs in there once it's on GitHub.
- Step 1 in progress: three-bank schemas, segment-to-track mapping (incl. BCR `micro` and `business (micro, IMM, corporate)`), six track-by-collection filter fields, provenance and freshness rules (`lib/rag/provenance.ts`), and the import builder. The import has 9,334 docs (37 withdrawn and 729 corporate chunks left out).
- Step 1 done: all 9,334 docs are re-imported into Convex and embedded with OpenAI. Personal: 2,308 bank, 3,906 competitor, 255 banking help. Business: 761 bank, 2,502 competitor, 50 banking help. Retrieval on the bank collection, hit@5: 8/8 original, 26/33 extended, 31/41 English (before: 8/8, 27/33, 30/41).
- Fix: `embeddings:saveEmbeddings` now writes 16 vectors per transaction. 64 hit Convex's "too many system operations" limit once there were six filter fields.
- Fixed `pnpm agent:check-setup` on Windows: `.gitattributes` keeps `agents/` in LF.

## Decisions so far

| Date | Decision | Source |
| --- | --- | --- |
| 2026-10-28 | Product name is **Raiffy** ("Ghid" and "Bank Buddy" are retired) | Andrei; commit `38ff692` |
| 2026-10-28 | The team builds **backend, LLM, RAG and pipeline only**. UI and design belong to the UI team | Andrei |
| 2026-10-28 | **No Docker** | Andrei |
| 2026-10-28 | Clerk roles are deferred; Convex functions get identity checks when Clerk is wired | Andrei; `CLAUDE.md` |
| 2026-10-28 | LLM through the **Anthropic SDK** (OpenRouter and Jev Router were rejected). The agent uses **Claude Sonnet 5.5** (`claude-sonnet-5-5`, override with the `RAG_MODEL` env var). `claude-3-5-sonnet-latest` was retired on 2025-10-28 and can't be called | Andrei |
| 2026-10-28 | **Embeddings: OpenAI `text-embedding-3-small`** (1536 dimensions), called from Convex actions. This replaces the earlier plan for a local e5/bge-m3 benchmark | Andrei |
| 2026-10-28 | **Agentic RAG**: Claude decides when and what to search through a `search_knowledge` tool; code runs each search scoped to the conversation's track | Andrei |
| 2026-10-28 | Vector store: **Convex** vector search plus a full-text index (hybrid search), on a local anonymous deployment for development | Andrei; `CLAUDE.md` |
| 2026-10-28 | Track to data segments: individuals see `persoane fizice`, `premium banking` and `private banking`; business sees `IMM`; `corporate` is out of scope. PDFs follow the products that link to them (every PDF links to products of a single track) | Andrei; data check |
| 2026-10-28 | POC rules from commit `38ff692`: English only (questions may still come in Romanian), answer scope (`compare` / `solution` / `detail`), one recommended option chosen by deterministic code, 2-3 pre-generated follow-ups, word-by-word streaming | `CLAUDE.md`, `raiffy-spec/CLAUDE.md`, `DESIGN.md` |

## How the agentic RAG works

1. `agent:ask({ question, track, threadId? })` creates or continues a conversation. A conversation keeps the track it started with, so personal and business data never mix.
2. Claude Sonnet 5.5 gets a cached system prompt (core rules plus a track overlay), the last 10 turns as plain text, and one strict tool: `search_knowledge({ query, focus })`.
3. Each search embeds the query with OpenAI, runs the Convex vector search and the full-text search, both filtered to the track, and fuses them with reciprocal rank fusion. Fee, rate, eligibility, document and tariff-PDF sections get a small boost when the query or the `focus` asks for them. It returns the top 5 fragments.
4. The fragments go back as `search_result` blocks with citations, one citable block per line, with the collection date first. Claude can search up to 3 times.
5. The final text is checked in code: every number must appear in a retrieved fragment, the question or the collection date. If one doesn't, Claude gets one retry. If an answer cites nothing after a single search, Claude is told to search once more with other words.
6. The answer is validated with Zod (`RagAnswer`: text, per-segment source ids, one source per cited page, checks, searches, retrieval) and saved with the question in `ragMessages`.

Settings: `max_tokens` 16000, effort `medium` (`RAG_EFFORT`), `fallbacks: "default"` (server-side fallback when a safety classifier declines), refusals handled.

## Built so far

| What | Where | Status |
| --- | --- | --- |
| TypeScript project (pnpm 12, TypeScript 7 strict, Vitest 5, tsx; Zod 4.6, `@anthropic-ai/sdk` 1.3, Convex 1.48) | `package.json`, `tsconfig.json`, `vitest.config.ts`, `pnpm-workspace.yaml` | Done |
| RAG Zod schemas (raw chunk, stored doc, search hit, search args, search focus) | `lib/rag/schemas.ts` | Done, tested |
| Text normalization, track visibility, query plan (EN to RO keyword expansion, intents, focus), fusion, ranking | `lib/rag/normalize.ts`, `visibility.ts`, `query.ts`, `fusion.ts`, `search.ts` | Done, tested |
| Number grounding (reads `50.000` and `50,000` as the same value) | `lib/rag/numbers.ts` | Done, tested |
| Agent prompts, the strict `search_knowledge` tool, `search_result` and tool-result builders | `lib/rag/prompt.ts` | Done, tested |
| Citation parsing and answer assembly, `RagAnswer` schema | `lib/rag/answer.ts` | Done, tested |
| Agent loop (pure: the model call and the search are passed in) | `lib/rag/agent.ts` | Done, 8 tests with a scripted fake model |
| Convex schema: `ragChunks` (1536-dim vector index, full-text index, `embedded` index), `ragThreads`, `ragMessages` | `convex/schema.ts` | Done, deployed |
| OpenAI embeddings helper and batch indexing (`embeddings:embedPending`) | `convex/openai.ts`, `convex/embeddings.ts` | Done. All 3,750 chunks embedded in 2 min 12 s |
| Hybrid search action `rag:search` | `convex/rag.ts` | Done, deployed |
| Agent action `agent:ask` and query `agent:listMessages` | `convex/agent.ts` | Done, tested live |
| Convex import builder (Zod-validated, track visibility, search text, no vectors) | `scripts/build-rag-import.ts` | Done. 3,750 docs: 2,308 personal, 761 business, 681 hidden (corporate) |
| Retrieval eval sets: original 8, extended 33, English 41 | `raiffeisen-rag-package/starter/eval_questions*.json` | Done. Every expected pair was checked against `chunks.jsonl` |
| `starter/eval.py` with `--questions` and `--backend convex` | `raiffeisen-rag-package/starter/eval.py` | Done |
| Cloud dev Convex deployment `diligent-rhinoceros-830` (EU West) with `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` set | `.env.local` | 9,334 chunks imported and embedded |

Tests: 44 Vitest tests pass; typecheck is clean.

## Results

Retrieval eval, hit@5 (the expected source in the top 5):

| Set | Starter (numpy, multilingual-e5-base, dense only, no track filter) | Raiffy (Convex hybrid, OpenAI embeddings, track filter) |
| --- | --- | --- |
| Original 8 (Romanian) | 4/8 | **8/8** |
| Extended 33 (no diacritics, typos, business, tariffs) | not run | 27/33 |
| English 41 | not run | 30/41 |

Several misses return a page that answers the question but isn't the one the eval expects (the general personal-loan conditions page instead of the product page; the tariff PDF instead of the Zero Simplu page). Real misses: English questions about IMM investment loans and some fee questions. The agent makes up for part of this by searching again in Romanian.

Agent checks, run live:

- "What interest rate does the 3-month term deposit in lei pay?" (personal): one search; 4.70% and 5.00% given, cited and grounded; AI disclosure and collection date included; 10.5 s.
- "What is the maximum overdraft my company can get?" (business): with effort `low` and one search it said it couldn't find the limit. With effort `medium` and the search-again rule it searched twice and gave "maximum 35% of turnover, minimum 7.000 Euro/Lei", cited; 10.8 s.
- Follow-up in the same thread, "And what is the exact analysis fee for it?": said plainly the fee isn't in the pages and pointed to the IMM tariff PDF and the product page.

## Next steps

1. Improve chunk ranking within a page (see the finding above) and retrieval on the English set: translate the query to Romanian for the keyword leg, or let the agent always run one Romanian query.
2. Agent eval: run the 41 English questions through `agent:ask` and check that the answer cites the expected source (it costs Anthropic tokens: ask first).
3. Answer-formulation plan (individuals, business, user-type adaptation, tool catalog, `chat.html` mapping): the individuals section is drafted; the business and tools sections need a rerun.
4. Add tools: the financing simulation (`chat.html` `simCalc`, with the deterministic recommendation), a financial plan from a chat, a new chat that keeps context.
5. Wire Clerk: identity checks in `agent:ask` and `agent:listMessages`. Right now anyone with a thread id can read that thread (fine for local development only).

## Open questions for the team

- Money and rates in schemas: integer bani and basis points?
- Answer cache: cache only what the LLM writes (never numbers), exact-match first and semantic later?
- Should the `track` field go into the Answer envelope now?
- Follow-ups: built by code from pattern templates, with the LLM only choosing and phrasing them?
- EU hosting for embeddings in production (OpenAI EU residency needs approval).

## How to run

```bash
pnpm install
pnpm test && pnpm typecheck

# Convex (the cloud dev deployment selected in .env.local; `pnpm exec convex dev --once` pushes changes)
pnpm rag:build-import                                                   # -> ragChunks.import.jsonl
pnpm exec convex import --table ragChunks --append -y ragChunks.import.jsonl   # --replace only if you mean to wipe it
pnpm exec convex run embeddings:embedPending                             # OpenAI embeddings for every chunk
pnpm exec convex import --table regulatoryLimits --replace -y catalog/regulatory-limits.jsonl   # limits for the affordability check
pnpm exec convex run agent:ask '{"question": "What does the 3-month deposit pay?", "track": "personal"}'

# Retrieval evals (search_knowledge): offline data check, live sets, data-level isolation audit
pnpm rag:eval --offline
pnpm rag:eval                       # or: pnpm rag:eval competitors isolation legacy
pnpm rag:eval --audit

# Older retrieval eval against Convex
raiffeisen-rag-package/.venv/Scripts/python.exe raiffeisen-rag-package/starter/eval.py --backend convex
raiffeisen-rag-package/.venv/Scripts/python.exe raiffeisen-rag-package/starter/eval.py --backend convex --questions raiffeisen-rag-package/starter/eval_questions_en.json
```
