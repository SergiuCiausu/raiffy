# Backend integration status

The backend now combines teammate PR #4 with the local Jev and memory implementation. Most progress is in tested backend components. The seven product milestones are not yet complete end to end because the browser chat still runs scripted flows and the financial tools are not connected.

## What was combined

PR [#4](https://github.com/SergiuCiausu/raiffy/pull/4), by `Andr31uq`, was already merged into `main` at `2bb0b37`. It added `convex/agent.ts`, a bounded Claude search loop, persisted RAG threads/messages and OpenAI `text-embedding-3-small` embeddings. It replaced `ragAnswer:answer` and removed the local Python embedding service. Its vector index uses 1536 dimensions.

Local snapshot `9c94852` adds the Jev transport, independent routing/risk/memory decisions, scoped memory proposals and lifecycle, consent/provenance records, retention jobs and tests. The combined schema preserves these tables alongside the PR's RAG tables and embedding changes. Root UI source matched the version already on `main`; no UI rewrite was included. The 27 MB public competitor data package and design references remain local files, outside this code publication.

The merge also fixes issues found during review:

- Paid `agent:ask` and `rag:search` require an authenticated identity before any provider call. Thread helpers and public reads/writes enforce server-derived user, track and signed organization scope. Legacy unowned threads are inaccessible rather than silently assigned. Message/history reads are bounded.
- Numeric checks now use each segment's valid cited fragments, rather than the customer's question or an unrelated retrieved hit. Invalid citation indexes fail validation.
- Truncated model replies cannot become successful answers, and exhausted loops return schema-valid failures.

These changes do not implement a full PII pipeline, prove semantic financial correctness or connect Jev to the RAG loop.

## Milestone assessment

| Milestone | Working components | Still required |
| --- | --- | --- |
| 1. Secure backend boundary | Server keys exist; paid endpoints and threads now have real-identity ownership checks. Memory has scoped provenance and a conservative demo privacy screen. | Clerk JWT configuration and browser sign-in; shared PII screening before storage and every provider call; rate/cost limits; organization permission acceptance tests. The RAG action still receives raw authenticated questions/history. |
| 2. Retrieval and structured catalog | Hybrid vector/keyword search, track filters, source citations, public-product import builder, cloud embedding batch action and a 1536-dimensional index. | Normalize/import the combined three-bank package; retain bank, withdrawn status, effective/review dates; product and source filtering; structured rates/fees catalog; independent retrieval evaluations. The cloud RAG table was empty at audit time. |
| 3. Jev classification | Real transport, bounded deadline and response size, pinned model/schema, uncertainty handling and risk overrides. | Enable the deployment feature flag, connect it to the chat entry point, run live EN/RO classification evaluations and calibrate thresholds. Provider tests use mocks; key presence does not establish a successful request. |
| 4. Complete chat pipeline | A bounded Claude `search_knowledge` loop, conversation persistence, citations, retries and stricter output checks. | Connect stored screened message → Jev → route planner → correct tools → RAG/Claude; add the spec's deterministic `Answer` composer and block validation; bind the browser chat to it; handle streaming/errors. Current `ChatApp` uses `FLOWS`, and auth screens simulate sign-in. |
| 5. Calculations and expenses | Pure demo loan/overdraft comparison functions and deterministic recommendation exist in `web/lib/finance.ts`. | Server calculator tools with sourced terms, decimal/rounding acceptance, complete fee/APR scenarios and deterministic expense/income/debt aggregates. Current demo terms are illustrative. |
| 6. Negotiation | Classification, tool contracts, policy language and hardship suppression exist in the route planner. | Comparable catalog inputs, approved-offer records, authorized pricing rules and adviser handoff. The live RAG loop does not enforce the Jev sales gate yet. There is no working counter-offer engine. |
| 7. Persistent memory | Proposal, confirmation, listing, correction, deletion, idempotency, scope checks and expiry cron are implemented and covered by lifecycle tests. | Real-user auth/privacy acceptance, confirmation UI, retrieval into the answer loop, semantic memory search if needed and production persistence. The enabled demonstration path is restricted to synthetic identity and an explicitly pinned dev deployment; real-customer writes remain disabled. |

Counting source files or assigning an overall percentage would overstate readiness. The classifier and memory lifecycle are the strongest individual components; the user-facing integration and financial tool layer remain the largest gaps.

## Data and cloud checks

The configured development deployment is `diligent-rhinoceros-830` in EU West. Read-only checks verified the presence of `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and `TYPESAFE_API_KEY` without reading their values. The first RAG/memory rows were absent. No customer message was sent to a model and no bulk embedding was started during this audit.

The source package contains 10,100 chunks. Against the current import schema, 8,568 validate and 1,532 fail enum validation. The schema strips the bank field from every accepted row and strips status when present. Importing this package unchanged would lose information needed to distinguish banks and exclude withdrawn products. The existing builder defaults to the older Raiffeisen-only package.

OpenAI embeddings remove the localhost dependency, but the helper currently calls the global API endpoint. EU processing arrangements for model requests and query embeddings remain unverified. An EU Convex database alone does not establish where model providers process their inputs. Do not send real financial/customer data until that boundary is settled.

Numeric presence in a cited fragment still does not prove that a rate, currency, product, unit or condition is correct. Typed catalog facts, deterministic calculations and a claim-support check remain necessary for financial answers. A matched number alone is insufficient.

## Fastest path to actual agent tests

1. Wire Clerk to the backend and browser, and put shared PII screening at the chat/provider boundary. Start with synthetic test accounts and messages. Keep server-derived identity and the new thread isolation guards.
2. Normalize and preserve the three-bank metadata, import public chunks, generate their embeddings and verify exact expected source URLs in the top five for a small EN/RO product, fee and competitor set. Add an authenticated evaluation path; the old unauthenticated retrieval evaluator now correctly fails at the access guard.
3. Connect the existing Jev action and planner before the existing Claude RAG loop. For the first testable slice, support product explanations and sourced factual comparisons. Return an explicit unavailable state for calculators, account data, offers and memory that are not connected.
4. Bind the real chat UI to that backend action and validate the `Answer` response. Run normal, ambiguous, no-source, stale/withdrawn, fraud, hardship, wrong-user, provider-timeout and invalid-citation scenarios. Measure actual latency, tokens, answer support and classification outcomes.
5. Add deterministic finance/expense tools and then authorized negotiation. Connect customer-confirmed memory to the same chat loop after real-user privacy controls are accepted.

The first live milestone is a signed-in synthetic customer receiving a sourced answer through Jev and the Claude retrieval loop in the app. Full negotiation and account-data personalization can follow that verified path.

## Validation

The merged backend suite currently contains 138 passing tests. Root and Convex TypeScript checks, generated agent setup consistency and whitespace checks pass. Tests include thread user/organization isolation, unauthenticated paid-call denial, memory lifecycle, provider transport faults, bounded loops and citation regressions. Provider calls in these tests are mocked; live classification quality and full in-app behavior are unmeasured.
