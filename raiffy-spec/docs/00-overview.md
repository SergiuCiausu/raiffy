# Raiffy: Overview

Raiffy is Raiffeisen Bank Romania's AI financial assistant. It helps people and small businesses navigate financial decisions by comparing the ways to pay for a goal (how many depends on the question: see the answer scope rule in `docs/individuals/answer-patterns.md`), recommending one and saying why, showing every commission, and being honest about competitors while openly favoring Raiffeisen. The POC is English only, in the interface and in answers. Multi-language support comes later.

## Two tracks, one core

| Track | Who | Spec folder |
| --- | --- | --- |
| Individuals | Retail customers | `docs/individuals/` |
| Businesses | PFAs, freelancers, liberal professions, micro and small companies | `docs/business/` |
| Shared core | Answer schema, pipeline, plan summaries | `docs/shared/` |

The shared core is built once and parameterized by `track`. Business files list only what's different or added; everything else in the individuals files applies to businesses too.

## Five layers (how every spec file is organized)

| Layer | Where it lives in the app |
| --- | --- |
| **Behavior rules** | System prompt, per-pattern prompts, fixed scripts, and the LLM evaluator's rubric |
| **Hard limits** | Code: guardrails, tool permissions, output checks, infrastructure; never prompt-only |
| **Calculations** | Deterministic, unit-tested tools and data rules; the LLM never does math |
| **Edge cases** | Evals and tests run on every change |
| **Regulations** | Compliance processes, documentation and official sources, owned by people |

Answer patterns (the eleven structures per track), the answer schema (envelope plus blocks) and the six-step pipeline sit across these layers.

## File map

```
CLAUDE.md                                  instructions for Claude Code
docs/00-overview.md                        this file
docs/individuals/behavior-rules.md
docs/individuals/hard-limits.md
docs/individuals/calculations.md
docs/individuals/answer-patterns.md        core financing-route rule + 11 patterns
docs/individuals/evals.md
docs/individuals/regulations.md
docs/shared/answer-schema.md               envelope, 12 blocks, recipes, UI, i18n, build stack, demo
docs/shared/pipeline.md                    safety gate, router, orchestrator, evaluator, thinking panel
docs/shared/plan-summary-handoff.md        indicative plan PDF and handoff to official flows
docs/business/scope-and-roadmap.md         segments, differences, shared vs specific, build order
docs/business/behavior-rules.md
docs/business/hard-limits.md
docs/business/calculations.md              business tools, eligibility, dated tax config
docs/business/answer-patterns.md           business routes catalog + 11 patterns
docs/business/evals.md
docs/business/regulations.md
docs/business/schema-and-pipeline.md       business blocks and pipeline differences
docs/comparison/individuals-vs-businesses.md
docs/decisions/product-decisions.md        stack, RAG, login and consent, landing page, human verification
docs/sources.md
```

## Source codes in tables

Many tables have a Source column. `EC` refers to the "Edge Cases, Concepts & Regulations" reference doc and `Auth` to the "Regulations by Authority" reference doc; neither is in this bundle, but the solutions taken from them are. Law names (e.g., OUG 50/2010) point to the regulation behind a rule.

## Build order

1. Shared core for the individuals track: schema and validators, safety gate, router, composer, calculator and comparison tools, evaluator checks, rendering registry, thinking panel.
2. Individuals answer patterns, starting with pattern 1 (purchase goal: the BMW X5 demo) and pattern 2 (product comparison).
3. Orchestrator and multi-goal plans; LLM evaluator rubric.
4. Plan summaries, human verification, landing page and login.
5. Business track: track switch and business profile, then PFA patterns first (cash-flow gap, equipment, funding programmes), then micro and small companies.

## Non-negotiables

- When money is involved, the number of routes follows the answer scope (compare: the options named; solution: at least three, including not borrowing; detail: one product plus a follow-up question). One option is recommended, with its reasons.
- Every commission listed, or "no commissions" stated only when every fee is confirmed zero and fresh.
- Every number comes from a tool, with a source and date; no number in text that isn't in a block.
- AI disclosure on the first message; a human always one tap away.
- Raiffeisen favored only openly; cheaper competitors always disclosed. Negotiation compares total cost first, then makes a counter-offer inside the pre-approved band or escalates to a specialist (pattern 11).
- No investment, tax or legal advice; refer out.
- Hardship and crisis modes suppress all offers.
- Values that change (rates, fees, tax thresholds, programmes) live in dated data or config, never in prompts.
