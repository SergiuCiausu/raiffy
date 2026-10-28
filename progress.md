# Raiffy build progress

Tracks what has been built, what's in progress, and what's next. Update it whenever a piece lands.

Last updated: 2026-10-28 15:10 (Bucharest). Branch: `backend/rag-foundation`.

## Agent foundation update 2026-10-28

- Refreshed backend through `e480df3`. Added pure TypeScript Jev request/response contracts, deterministic routing, model policy and memory retrieval boundaries in `lib/agent/`.
- The current owner request adds **TypeSafe Jev for inquiry classification**, while Claude remains the generator. This is separate from the previously rejected Jev Router gateway below.
- Generated console-style setup is in `agents/raiffy.agent.yaml`; request and policy examples sit alongside it. Regenerate with `pnpm agent:build-setup`; check with `pnpm agent:check-setup`.
- Setup guide: `raiffy-spec/docs/plans/agent-foundation.md`. Initial assumptions are the existing Convex/Messages API runtime and memory only on explicit user request. Sonnet remains the default; optional Opus escalation is disabled.
- Tool declarations are contracts, not implemented handlers. No new provider transport, full agent loop, auth/PII adapter, expense connection, competitor collection or private memory persistence is enabled. The existing public-product RAG action remains separate.
- Added labeled EN/RO routing examples under `evals/agent-routing.json`. These are not measured Jev results. Confidence thresholds are provisional and need calibration.
- Validation: generated setup matches its sources; TypeScript checks pass. Unit tests cover routing, risk overrides, capability checks and memory isolation. No live provider or in-app acceptance run yet.

## Task 2: retrieval and catalog (Andrei), 2026-10-28

- Plan agreed: `raiffy-spec/docs/plans/retrieval.md`. It uses Denis's architecture and contracts (`search_knowledge`, `get_product_terms`), OpenAI embeddings, `banks-data-package/` as the single data source (Raiffeisen, ING, BCR) and `comparatie.csv` as the catalog seed.
- Added `banks-data-package/` (10,100 chunks, snapshot 2026-10-28). Scope rule confirmed: tools get their scope only from a server-side `resolveScope`; Denis's auth work (task 1) plugs in there once it's on GitHub.
- Step 1 in progress: three-bank schemas, segment-to-track mapping (incl. BCR `micro` and `business (micro, IMM, corporate)`), six track-by-collection filter fields, provenance and freshness rules (`lib/rag/provenance.ts`), and the import builder. The import has 9,334 docs (37 withdrawn and 729 corporate chunks left out). The re-import into Convex and re-embedding are still to do.
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
| Local Convex deployment with `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` set | `.env.local` | Running on http://127.0.0.1:3210 |

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

1. Improve retrieval on the English set: translate the query to Romanian for the keyword leg, or let the agent always run one Romanian query.
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

# Convex (local deployment; keep `pnpm exec convex dev` running to push changes)
pnpm rag:build-import                                                   # -> ragChunks.import.jsonl
pnpm exec convex import --table ragChunks --replace -y ragChunks.import.jsonl
pnpm exec convex run embeddings:embedPending                             # OpenAI embeddings for every chunk
pnpm exec convex run agent:ask '{"question": "What does the 3-month deposit pay?", "track": "personal"}'

# Retrieval eval against Convex
raiffeisen-rag-package/.venv/Scripts/python.exe raiffeisen-rag-package/starter/eval.py --backend convex
raiffeisen-rag-package/.venv/Scripts/python.exe raiffeisen-rag-package/starter/eval.py --backend convex --questions raiffeisen-rag-package/starter/eval_questions_en.json
```
