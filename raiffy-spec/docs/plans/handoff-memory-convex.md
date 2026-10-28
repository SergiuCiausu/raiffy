# Handoff: data zones, Jev memory candidates and the Convex memory store

Written 2026-10-28 for the agent taking over the memory, Convex MCP and Jev work. Read `CLAUDE.md`, `raiffy-spec/CLAUDE.md` and `raiffy-spec/docs/plans/agent-foundation.md` first; this file only records what was decided and done in the planning conversation, and what is next.

## Repo state

- Checkout: `/Users/doax/Projects/Raiffy`, branch `backend/rag-foundation`, HEAD `e480df3` ("back end, putin din RAG si din Convex"). Remote: `github.com/SergiuCiausu/raiffy` (`main` holds the spec and HTML prototypes).
- **Nothing from this conversation is committed.** Working tree:
  - Modified: `progress.md`, `package.json` (adds `agent:build-setup` and `agent:check-setup`).
  - Untracked and part of this work: `lib/agent/`, `agents/`, `evals/agent-routing.json`, `raiffy-spec/docs/plans/agent-foundation.md`, this file.
  - Untracked and **not** part of it: `design-references/` (contains macOS `._*` files) and `.env.example`. Leave them out of any commit unless the owner says otherwise.
  - `lib/agent/`, `agents/` and `agent-foundation.md` were drafted by someone on the team before this conversation; this conversation extended them. The owner has not yet decided whether to commit.
- Checks at handoff: `pnpm test` (59 passing), `pnpm typecheck` clean, `pnpm agent:check-setup` matches.

## Existing RAG (before this conversation)

- `convex/schema.ts`: `ragChunks` with `multilingual-e5-base` embeddings (768 dims), `by_embedding` vector index and `search_text` full-text index, both filtered on `visiblePersonal` / `visibleBusiness`.
- `convex/rag.ts` (hybrid search) and `convex/ragAnswer.ts` (grounded answer with Claude `search_result` citations), `lib/rag/*` (pure helpers with tests), `scripts/build-rag-import.ts`, `tools/rag/embed_chunks.py`, `tools/rag/embed_server.py` (local query-embedding service).
- Data: `raiffeisen-rag-package/` (3,750 Romanian chunks, `products.json` with 208 products). Known gap: structured rates exist for only one deposit page and five representative examples, so loan offers must be seeded by hand.
- The query-embedding service runs on localhost; it only works while the Convex deployment is the local one. Switching to a hosted embedding provider needs the owner's approval (EU hosting).
- `convex/rag.ts` and `convex/ragAnswer.ts` were not reviewed in this conversation.

## Data architecture decided

Two zones, both in the same Convex deployment, separated by tables, indexes and server-side ownership checks. Numbers come from structured tables, never from vector search.

**Private zone**, keyed by `ownerKey + track + organizationKey` (business data belongs to the Clerk Organization, never to a CUI typed in chat; the Personal / Firma mea switch never mixes data):

| Store | Written by | Status |
| --- | --- | --- |
| Conversation state (`conversations`, `messages` with PII masked): goals, amounts, slider values, tool results | Pipeline, automatically every turn | Not built |
| `userMemories`: goals, preferences, constraints, stated financial figures | Proposals from Claude, confirmed by the customer | Contracts and scorer built; no table |
| User-claimed competitor offers ("ING offered me 7.2%") | Extracted, confirmed by the customer; labeled "as you stated", never a market fact | Not built |
| `approvedOffers`: bank-authorized offers and relationship prices | Bank only; synthetic seed for the demo persona | Not built |
| Account aggregates (`get_expense_summary`) | Bank connection; synthetic for the demo, clearly marked | Not built |

**Public zone:**

| Store | Purpose | Status |
| --- | --- | --- |
| `productTerms`: Raiffeisen and competitor offers | The only source of rates, fees and conditions | Not built |
| `ragChunks` (`bank_product_docs`) | Explanations | Built |
| `competitor_docs`, `banking_help` | Explanations | Not built; later |
| Dated config (`DatedValue`: tax values, BNR caps, programmes) | Business and credit rules | Not built |

**Improvement** comes from pseudonymized logs (unanswered questions, evaluator verdicts, operator edits, proposal accept/reject rates) turned into eval cases and FAQs. No fine-tuning, and one customer's data never feeds another's answers.

`productTerms` must follow `raiffy-spec/docs/individuals/calculations.md`:

- every fee type present with an explicit value (0 = confirmed none, null = unknown); `hasNoCommissions` only when all are 0 and fresh;
- promo and standard rates both stored, conditions as structured fields;
- "from" rates as ranges with `minOnly`;
- source precedence SECCI / ESIS / FID over the website; `sourceUrl`, `sourceDocType`, `lastVerifiedAt` with a freshness limit; stale rows excluded and reported in `staleData`;
- comparability rules (category, term range, currency, insurance) and ranking by customer cost, never margin;
- recommended: money in integer bani and rates in basis points (still an open question in `progress.md`).

Negotiation: the agent never invents a discount. A cheaper competitor is disclosed, followed by a counter-offer that uses a real `approvedOffers` row or books an adviser review (`request_human_handoff`).

## Done in this conversation: Jev memory candidates (policy `raiffy-agent@2`)

The owner wants the agent to keep capturing what the customer reveals, with consent. Jev decides **whether**, Claude writes **what**, code checks, the customer decides **if it stays**.

- `lib/agent/jev.ts`: new Choice `memory_candidate` (`none`, `goal`, `preference`, `constraint`, `stated_financial`) and Noul questions `memory_durable` and `special_category`. `RISKS` is exported and reused.
- `lib/agent/memory.ts`: `MEMORY_KINDS` adds `stated_financial` to proposals and records; `scoreMemoryCandidate` returns a candidate when P(kind) × P(durable) ≥ `thresholds.memoryCandidate` (0.6), and returns null for explicit memory operations, any risk ≥ 0.3, or `special_category` ≥ 0.2. `MEMORY_POLICY` now says `candidates: explicit_request_or_jev_classifier`, `consent: customer_confirms_each_memory`, retains stated financials, excludes special-category data. `persistenceEnabled` stays `false`.
- `lib/agent/config.ts`: the two new thresholds (provisional), version bumped to `raiffy-agent@2`.
- `lib/agent/route.ts`: `memoryCandidate` on the route plan; an accepted candidate adds `propose_memory_change` to the normal answer's tools without changing handler or model, or lists it in `unavailable`.
- `lib/agent/prompt.ts`: Claude proposes only what the customer said, with the exact quote, and does not interrupt the answer; the app batches confirmations into one card at the end of a topic.
- Tests in `lib/agent/agent.test.ts`; 7 new labeled cases in `evals/agent-routing.json`; `agents/*` regenerated; `agent-foundation.md` and `progress.md` updated.

Rules carried from the spec: stated figures are the customer's dated claim, usable only as labeled calculator inputs; never for credit scoring (`regulations.md`); memory cannot authorize marketing (separate consent); no inferred traits, special-category data or other people's data.

## Next tasks, in order

1. **Convex MCP.** The owner will add it: `claude mcp add convex -- pnpm dlx convex@latest mcp start`, with `pnpm convex:dev` running. It must point at the dev deployment only; keys stay in `.env.local`.
2. **Decision needed before building the memory store:** Clerk is not wired, so `ctx.auth.getUserIdentity()` returns null. Proposed: a dev-only demo identity (an env var on the dev deployment, ignored in production) mapped to a synthetic persona. Ask the owner first.
3. **Memory store in Convex:** `memoryProposals` and `userMemories` tables (indexed by owner and status, separate from `ragChunks`); `convex/memory.ts` with an internal `propose` mutation (verifies the quote against the stored, masked message and blocks sensitive data) and identity-checked `confirm`, `reject`, `listMine`, `forgetAll`; a cron that removes expired memories, with expiry per kind (suggested: stated figures 90 days). Owner always comes from identity, never from arguments. Keep it behind `persistenceEnabled`. Verify through the MCP: tables, one proposal, confirm, delete.
4. **Jev transport adapter:** `POST https://api.typesafe.ai/v1/systemone`, key in `Authorization: Bearer` server-side only, model pinned to `jev-1.14.0`, timeout and safe fallback. No live Jev call has been made; the thresholds need calibration on `evals/agent-routing.json`.
5. **Demo data path** (from the spec's 90-second demo: BMW X5, multi-goal, BT winning one metric, counter-offer): `productTerms` with a hand-curated seed (Raiffeisen, BT and one or two more banks for personal and car loans, each with source and date; unverified figures marked illustrative); `lib/compare/` with Vitest tests; conversation tables; synthetic `approvedOffers` for the demo persona.

Later: competitor documents in RAG, memory embeddings (same local e5 model, owner-filtered), real account data, business-track competitor comparison (an open question for Raiffeisen).

## Working rules (from the repo)

- pnpm only; TypeScript strict; Zod on every input and output; `lib/` stays pure (no I/O, no `process.env`, no Node APIs); Convex actions for anything external.
- Every calculation and guard gets a Vitest test; each implemented behavior rule gets an eval case.
- No hardcoded rates, fees or terms; values come from dated, sourced records.
- English only in the interface and answers.
- Ask the owner before anything touching credit decisions, investment advice, payments or signatures, and before choosing an embedding or hosting provider.
- After changing `lib/agent/`, run `pnpm agent:build-setup`, then `pnpm test`, `pnpm typecheck` and `pnpm agent:check-setup`.
