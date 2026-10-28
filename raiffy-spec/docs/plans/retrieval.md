# Retrieval and product catalog (task 2)

Owner: Andrei. Agreed with the team on 2026-10-28. It builds on `agent-foundation.md` (Denis): Jev classifies, the route plan picks collections and tools, code runs the tools, the composer builds the Answer, and Claude frames the result.

Task 2 delivers the data and the two tool backends that plan needs:

- `search_knowledge`: dated passages for explanations, over the logical collections.
- `get_product_terms`: exact rates, fees and conditions as typed, dated records.

Both run with a scope the host provides, never one chosen by the model or the customer's text. Both are tested without Claude.

## Done when

- All three banks' data is imported under one provenance schema, with OpenAI embeddings.
- `search_knowledge` and `get_product_terms` follow the contracts in `agents/raiffy.agent.yaml`.
- Acceptance tests pass (see "Tests and acceptance").

## Decisions

| Topic | Decision |
| --- | --- |
| Source data | `banks-data-package/` (Raiffeisen, ING, BCR; 10,100 chunks; snapshot 2026-10-28). `raiffeisen-rag-package/` stays only for its eval sets |
| Embeddings | OpenAI `text-embedding-3-small` (1536 dimensions), called from Convex actions. No local model |
| Tool contracts | Denis's, unchanged: `search_knowledge({ collection, query, limit })`, `get_product_terms({ query, productIds })` |
| Collections | `bank_product_docs` = Raiffeisen; `competitor_docs` = ING and BCR; `banking_help` = Raiffeisen FAQ chunks only (other banks' answers can differ); `user_memory` is not part of task 2 |
| Glossary | `banking_help` starts with the FAQ chunks; a sourced glossary (DAE, IRCC, ROBOR, FGDB...) comes later |
| Money | Integer minor units (bani), as in Denis's contracts |
| Rates | Integer basis points (5.55% = 555) |
| Withdrawn products | Excluded everywhere (`status: "withdrawn"`, 37 BCR chunks) |
| Hub pages | Kept in RAG for explanations, never in the catalog |
| Freshness | `reviewBy` = collection date + 30 days for rates, fees, limits and campaigns (sooner when the source states an end date), + 90 days for eligibility and documents. Past `reviewBy`, a value is `unavailable` |

## Track and scope

Segments map to tracks:

| Segment | Track |
| --- | --- |
| `persoane fizice`, `premium banking`, `private banking` | personal |
| `IMM`, `micro`, `business`, `business (micro, IMM, corporate)` | business |
| `corporate` | excluded |

PDFs carry no segment and follow the products that link to them; a PDF linked to both personal and business products is visible in both (129 BCR chunks). BCR's `business (micro, IMM, corporate)` pages can include corporate content that can't be separated; they stay in the business track.

Every tool gets a `Scope` from the host: `{ track, ownerKey?, organizationKey? }`. One server function, `resolveScope(ctx, requestedTrack)`, builds it. Until authentication lands (task 1) it returns the track the server-side caller passed. Afterwards it derives the track from the Clerk identity and organization and rejects tracks the user can't use. Tool inputs never contain a track, an owner or an organization. A conversation keeps the track it started with.

## Schemas (Zod in `lib/`, mirrored in `convex/schema.ts`)

**Provenance**, on every passage and every term:

```ts
type Provenance = {
  bank: "raiffeisen" | "ing" | "bcr";
  url: string;            // shown as the citation
  chunkId?: string;       // the chunk the value or passage comes from
  collectedAt: string;    // ISO, from metadata.scraped_at
  effectiveFrom?: string; // when the source states one ("valabil din ...")
  reviewBy: string;       // freshness deadline (see Decisions)
  status: "fresh" | "stale";
};
```

**Passage** (`search_knowledge` result item): `passageId`, `collection`, `bank`, `product`, `productId`, `sectionType`, `docType`, `text`, `provenance`, `score`.

`search_knowledge` returns `{ status: "ok" | "unavailable", collection, passages, coverage: { returned, gaps[] }, reason? }`. An unavailable collection returns `unavailable`, never another collection's content. The composer passes passages to Claude as `search_result` blocks with citations.

**Term record** (`productTerms` table, `get_product_terms` result):

```ts
type TermRecord = {
  termId: string;
  productId: string;          // e.g. "raiffeisen:persoane-fizice__produsele-noastre__credite__..."
  bank: "raiffeisen" | "ing" | "bcr";
  track: "personal" | "business";
  kind: "interest_rate" | "dae" | "fee" | "limit" | "term" | "eligibility" | "document" | "benefit";
  label: string;              // e.g. "Comision de analiză"
  value:
    | { type: "exact"; amount: number }             // in `unit`
    | { type: "range"; min: number; max: number }
    | { type: "from"; min: number }                 // "de la 5,05%": never shown as the customer's rate
    | { type: "text"; text: string }                // conditions that aren't a number
    | { type: "unavailable"; reason: string };      // stated as missing on the page
  unit: "bps" | "minor_ron" | "minor_eur" | "months" | "years" | "days" | "none";
  conditions: string[];       // what the value depends on
  comparability: { category: string; termMonths?: number; currency?: "RON" | "EUR"; insuranceIncluded?: boolean;
                   rateType?: "fixed" | "variable" | "campaign" | "promo" };
  quote: string;              // exact text from the source chunk
  provenance: Provenance;
  verification: { quoteFound: boolean; reviewedBy?: string; reviewedAt?: string };
};
```

`get_product_terms` returns fresh records per product and lists every requested term that is missing, stale or unverified as `unavailable` with a reason. Missing is never zero: an empty fee field never becomes "no fee". Two values are compared only when their comparability keys match; otherwise the result says they aren't comparable.

## Building the catalog

1. **Import `comparatie.csv`** (72 hand-checked values for deposits, personal loans, credit cards and mortgages at all three banks). Each value gets its exact quote located in the source chunk.
2. **Extract the remaining Raiffeisen demo products** with Claude: candidate records with the exact quote. Code then checks that the quote exists in the chunk and that the value reads from the quote. A record that fails either check is dropped.
3. **Human review**: Andrei reviews the demo subset and sets `reviewedBy`. Only reviewed records count as verified.

Products in scope:

- **Personal:** personal loan without a mortgage, refinancing, overdraft, the four credit cards (Standard, eMAG, Platinum, Signature), term deposits and Fresh Money, the savings account, the ZERO Tot, ZERO Simplu and Premium packages, debit card fees.
- **Business:** Overdraft IMM, the IMM investment loan, the liberal-professions investment loan, the IMM account packages.
- **Competitors:** the products in `comparatie.csv`.

## Tests and acceptance

Every test runs without Claude.

| Test | Target |
| --- | --- |
| Original 8 questions, hit@5 | 100% |
| Competitor set (from `comparatie.csv`), hit@5 | 100% |
| English set (41), hit@5 | above 90% (now 30/41) |
| Catalog: question to exact value, unit and source | 100% |
| Track isolation: personal never returns business content, and the reverse; corporate never appears | 100% |
| Stale record returns `unavailable` | 100% |
| Missing value returns `unavailable`, never zero | 100% |
| Non-comparable values are flagged | 100% |

## Order of work

1. Add `banks-data-package/`, the provenance and segment mapping in `lib/`, and the import builder. Re-import all 10,100 chunks and re-embed them.
2. `search_knowledge` over the three collections; rerun the existing eval sets; add the competitor set.
3. The `productTerms` table and its schema; import `comparatie.csv`; build the quote verifier.
4. Extract and review the Raiffeisen demo products.
5. `get_product_terms`, with freshness, the missing-value rule and the comparability check; catalog evals.
6. Keep `convex/agent.ts` working on the new contract as a test harness. It's rebuilt on Denis's flow in task 4.

## Out of scope for task 2

Authentication and PII (task 1), Jev (task 3), the composer and number grounding in answers (task 4), calculators (task 5), negotiation (task 6), user memory (task 7).
