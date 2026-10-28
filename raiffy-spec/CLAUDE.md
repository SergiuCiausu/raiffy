# Raiffy

Raiffeisen Bank Romania's AI financial assistant for individuals and small businesses. Full context: `docs/00-overview.md` (read it first, every session).

## How to use the spec

Read only the files the task needs:

| Task | Read |
| --- | --- |
| UI, components, rendering, i18n | `docs/shared/answer-schema.md` (+ `docs/business/schema-and-pipeline.md` for business blocks) |
| Agent prompts, router, orchestrator, evaluator, thinking panel | `docs/shared/pipeline.md`, then the track's `behavior-rules.md` and `answer-patterns.md` |
| Tools and math | the track's `calculations.md` and `hard-limits.md` |
| Guardrails, permissions, privacy | the track's `hard-limits.md` |
| Tests and evals | the track's `evals.md` |
| Compliance questions | the track's `regulations.md` |
| Plan summaries and handoff to official flows | `docs/shared/plan-summary-handoff.md` |
| Login, consent, landing page, human verification, RAG design | `docs/decisions/product-decisions.md` |
| Anything business-specific | `docs/business/scope-and-roadmap.md` first |

Tracks: `docs/individuals/` and `docs/business/`. Business files only list differences; the individuals rules apply to businesses unless overridden.

## Rules for building

- **Numbers never come from the LLM.** All math is in deterministic, unit-tested tools; the composer builds UI blocks from tool results; the LLM writes only 2–3 framing sentences.
- **Every answer is an `Answer` envelope** with blocks from the fixed library, validated with Zod. Unknown or invalid blocks fall back to a `callout`; never let a bad block crash the screen.
- **Hard limits live in code**, not prompts: PII masking, user-scoped data access, no payment or signature collection, output checks.
- **No hardcoded facts.** Rates, fees, product terms, competitor data, tax thresholds and programme details come from the catalog, RAG store or dated config with `validFrom`, `sourceUrl`, `owner` and `reviewBy`. Stale values block the answer.
- **Tool data is language-neutral** (keys and numbers); components translate and format with `Intl`.
- **Each behavior rule and edge case should map to an eval.** When you implement a rule, add or update its test.
- **Ask before building anything that touches credit decisions, investment advice, payments or signatures**; these hand off to Raiffeisen's existing regulated flows.
- Accessibility: WCAG 2.1 AA, keyboard navigation, ARIA live regions for streamed text, `prefers-reduced-motion` respected.

## Stack

Locked for the POC: **Next.js** (App Router, pnpm), **Convex** as the only database and vector store, and **Clerk** for auth, user management and roles. Wiring rules are in `../CLAUDE.md` → "Product POC stack".

Also: the Vercel AI SDK (streaming and generative UI), Convex reactive queries and scheduled jobs, TypeScript and Zod, Framer Motion, Recharts or Visx, promptfoo for evals. EU hosting for the model endpoint, database and logs.

## Brand

Palette: navy `#06101D`, cyan `#3FD3F2` (only the recommended option glows), orange `#FF9A4D` (warnings and counter-offers). Fonts: Sora, IBM Plex Sans, IBM Plex Mono (numbers). Visual reference: the BMW X5 answer-screen mockup (add the exported HTML and a screenshot to `docs/ui/`).
