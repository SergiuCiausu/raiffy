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
| Operator and admin console: catalog editing, rules, prompts, reviews, evals | `docs/shared/console.md` |
| Relationship pricing, conditional discounts, competitor evidence, counter-offer bands and logging, client personas | `docs/shared/pricing.md` |
| Shared chats: share links, members and viewers, data scope, one agent per prompt | `docs/shared/shared-chats.md` |
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

## POC overrides

- **English only.** The interface and every answer are in English. Language detection, the RO/EN toggle and translated labels are deferred. Where this spec quotes Romanian copy, use the English equivalent.
- **Answer scope:** how many options an answer shows depends on the question (compare, solution or detail). See `docs/individuals/answer-patterns.md` → Core rule.
- **Streaming:** answers stream word by word after the thinking panel, not line by line.

## Brand

Palette, fonts and visual language come from `../DESIGN.md` and the HTML prototypes (`raiffy.html`, `login.html`, `chat.html`, `swipe.html`). Use the yellow `#FFD23F` and amber `#FF9A3D` accent as light, ink `#1A1A1A` for selection, and Geist with Geist Mono for numbers. They override any palette or font named elsewhere in this spec.
