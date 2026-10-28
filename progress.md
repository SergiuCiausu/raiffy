# Raiffy build progress

Tracks what has been built, what's in progress, and what's next. Update it whenever a piece lands.

Last updated: 2026-10-28 13:05 (Bucharest).

## Decisions so far

| Date | Decision | Source |
| --- | --- | --- |
| 2026-10-28 | Product name is **Raiffy** ("Ghid" and "Bank Buddy" are retired) | Andrei; commit `38ff692` |
| 2026-10-28 | The team builds **backend, LLM, RAG and pipeline only**. UI and design belong to the UI team | Andrei |
| 2026-10-28 | **No Docker** | Andrei |
| 2026-10-28 | Clerk roles are deferred; Convex functions get identity checks when Clerk is wired | Andrei; `CLAUDE.md` |
| 2026-10-28 | LLM through the **Anthropic SDK** (OpenRouter and Jev Router were considered and rejected). RAG answers use **Claude Sonnet 5.5** (`claude-sonnet-5-5`) | Andrei |
| 2026-10-28 | Vector store: **Convex** vector search plus a full-text index (hybrid search), on a local anonymous deployment for development | Andrei; `CLAUDE.md` |
| 2026-10-28 | Embedding model picked by a **local benchmark** (multilingual-e5-base, multilingual-e5-large, bge-m3) on the retrieval eval. Query embeddings come from a small local Python service | Andrei |
| 2026-10-28 | Track to data segments: individuals see `persoane fizice`, `premium banking` and `private banking`; business sees `IMM`; `corporate` is out of scope. PDFs follow the products that link to them (in this dataset, every PDF links to products of a single track) | Andrei; data check |
| 2026-10-28 | POC rules from commit `38ff692`: English only (questions may still come in Romanian), answer scope (`compare` / `solution` / `detail`), one recommended option chosen by deterministic code, 2-3 pre-generated follow-ups, word-by-word streaming | `CLAUDE.md`, `raiffy-spec/CLAUDE.md`, `DESIGN.md` |

## Built so far

| What | Where | Status |
| --- | --- | --- |
| TypeScript project (pnpm 12, TypeScript strict, Vitest, tsx; Zod 4.6, `@anthropic-ai/sdk` 1.3, Convex 1.48) | `package.json`, `tsconfig.json`, `vitest.config.ts`, `pnpm-workspace.yaml` (allows the esbuild build script) | Done |
| Git ignores for secrets, Convex local data, RAG build artifacts and the Python venv | `.gitignore` | Done |
| RAG Zod schemas: raw chunk, the stored Convex document, search hit, search arguments | `lib/rag/schemas.ts` | Done, tests pending |
| Text normalization: diacritic folding, tokens, Romanian and English stopwords, the 16-term search cap | `lib/rag/normalize.ts` | Done, tests pending |
| Track visibility derived from segments and linked products | `lib/rag/visibility.ts` | Done, tests pending |
| Query plan: English-to-Romanian keyword expansion for the keyword leg, intent detection (cost, interest, documents, eligibility, example), soft section preferences | `lib/rag/query.ts` | Done, tests pending |
| Reciprocal rank fusion of the vector and keyword rankings | `lib/rag/fusion.ts` | Done, tests pending |
| Number grounding: every number in an answer must appear in the sources (reads `50.000` and `50,000` as the same value) | `lib/rag/numbers.ts` | Done, tests pending |
| Retrieval eval sets: the package's original 8 questions (unchanged), 33 extended questions (no diacritics, typos, informal, business, cross-segment, tariff PDFs, eligibility, documents) and an English set of all 41 (the POC answers in English) | `raiffeisen-rag-package/starter/eval_questions.json`, `eval_questions_extended.json`, `eval_questions_en.json` | Done. Every expected source and text was checked against `chunks.jsonl` |
| Python venv for the starter and benchmarks (reuses the system torch 2.11 CPU build; adds sentence-transformers 6.2 and the Convex Python client) | `raiffeisen-rag-package/.venv` | Done |
| Model downloader that fetches only the files sentence-transformers needs | `tools/rag/download_models.py` | Done; downloads running |

## In progress

- **Embedding model downloads.** The network is slow (about 0.3 MB/s): multilingual-e5-base (~1.1 GB) is nearly done; e5-large and bge-m3 (~2.2 GB each) will take hours. The first starter run stalled on its own model download and was restarted.
- **Baseline:** `python starter/ingest.py` then `python starter/eval.py` (multilingual-e5-base), as soon as e5-base is downloaded.
- **Convex RAG:** `convex/schema.ts` (`ragChunks` with vector and full-text indexes and track visibility fields), a search action (hybrid search, track filter, fusion), a grounded answer action (Claude Sonnet 5.5, fragments passed as `search_result` blocks with citations, number check, one retry), the import builder and the query-embedding service.
- **Answer-formulation plan** (individuals track, business track, user-type adaptation, tool catalog, `chat.html` mapping). The individuals section is drafted; the business and tools sections stopped at the account's 5-hour usage limit and resume after 14:30.

## Blocked or waiting

| Item | Why | Unblocks when |
| --- | --- | --- |
| Parallel agents (plan drafting, eval verification) | The account hit its 5-hour usage limit | 14:30 Bucharest |
| Live answer generation | `ANTHROPIC_API_KEY` is not set on this machine | Someone sets the key with `pnpm exec convex env set ANTHROPIC_API_KEY ...` (never in code or `NEXT_PUBLIC_*`) |
| e5-large and bge-m3 benchmark | Slow model downloads | Downloads finish |

## Next steps

1. Unit tests for every `lib/rag` module.
2. Convex schema, search and answer functions; build and import the chunk documents; start the embedding service.
3. Run the baseline `starter/eval.py`, then the same questions against Convex (`--backend convex`), with and without the track filter, on the Romanian and English sets.
4. Pick the embedding model from the benchmark.
5. Finish the answer-formulation plan and save it under `raiffy-spec/docs/plans/`.

## Open questions for the team

- Money and rates in schemas: integer bani and basis points?
- Answer cache: cache only what the LLM writes (never numbers), exact-match first and semantic later?
- Should the `track` field go into the Answer envelope now, with only the personal track implemented?
- Follow-ups: built by code from pattern templates, with the LLM only choosing and phrasing them?

## How to run (so far)

```bash
pnpm install                     # Node dependencies
pnpm test                        # Vitest (lib/)
pnpm typecheck

# Python side (RAG data package)
raiffeisen-rag-package/.venv/Scripts/python.exe raiffeisen-rag-package/starter/ingest.py
raiffeisen-rag-package/.venv/Scripts/python.exe raiffeisen-rag-package/starter/eval.py
```
