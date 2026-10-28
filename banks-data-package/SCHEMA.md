# Data schema: Raiffeisen, ING and BCR

Public product information collected from each bank's own website (Romanian, diacritics used inconsistently).
**Snapshot taken on 2026-10-28, not live data.** Rates, fees and campaigns change; always show `metadata.scraped_at`.

## `data/chunks.jsonl` (one JSON object per line, 10,100 chunks)

| Field | Meaning |
|---|---|
| `id` | unique; `<bank>:<product path>#<section>-<n>` or `pdf-<bank>-<hash>#<n>` |
| `text` | **the text to embed**. Starts with `<bank>: <product> — <category> (<segment>)`, so every chunk stands alone |
| `metadata.bank` | `raiffeisen`, `ing` or `bcr` |
| `metadata.bank_name` | display name |
| `metadata.source_type` | `product_page` or `pdf` |
| `metadata.section_type` | `overview`, `features`, `description`, `fees`, `fee_table`, `rate_table`, `table`, `interest_rates`, `eligibility`, `required_documents`, `faq`, `representative_example`, `pdf` |
| `metadata.product`, `product_id` | product name and a stable id (product pages only) |
| `metadata.segment` | `persoane fizice`, `IMM`, `corporate`, `micro`, `business (micro, IMM, corporate)`, `business`, `private banking`, `premium banking` |
| `metadata.category`, `subcategory` | Raiffeisen: from the site breadcrumb. ING/BCR: derived from the URL (no diacritics) |
| `metadata.currencies` | `RON`, `EUR`, `USD`, `GBP`, `CHF` detected in the text |
| `metadata.status`, `page_type` | ING/BCR only: `active` or `withdrawn`; `product` or `hub` (a category overview page) |
| `metadata.url` | page or PDF the text came from. **Show it as the citation** |
| `metadata.scraped_at` | ISO timestamp of collection |
| `metadata.doc_type`, `title`, `page_start`, `page_end` | PDF chunks only (`tarife`, `dobanzi`, `contract`, `fisa`, `regulament`, `ghid`, `termeni`) |

Counts: chunks per bank bcr 4,283, ing 2,067, raiffeisen 3,750; products per bank raiffeisen 208, ing 84, bcr 261; PDF chunks per bank bcr 1,126, raiffeisen 1,974.

## Other files

- `data/<bank>/products.json` and `.csv`: one structured record per product page (name, segment, category, sections,
  FAQ, tables, PDF links, DAE, limits, `missing_fields`). The chunks are derived from these.
- `data/comparison/comparatie.html` / `.csv`: a hand-checked comparison for presentation: term deposits, personal
  loan, credit card, mortgage. Every figure has a source URL and the condition it depends on.

## What is NOT in the data (read before relying on it)

- **ING PDFs.** ING's robots.txt forbids PDF crawling, so ING's full fee and rate lists are missing; only the links
  are recorded (`pdfs[].robots_blocked`). ING's APR (DAE) is also filled in by JavaScript, so it is mostly absent.
- **Raiffeisen and BCR fees/eligibility** are thin on the web pages: most complete fee lists live in shared tariff
  PDFs, which are chunked as `pdf` (not attributed to a single product).
- **Structured fields are heuristic.** `limits.min_*`/`max_*`, `eligibility`, `required_documents` and `interest_rates`
  are missing on many products (see each `missing_fields`). The Raiffeisen `interest_rates.mentions` field is
  under-populated (a regex gap); rely on the chunk text there.
- **Comparing banks:** representative examples differ (e.g. credit-card APR examples use different limits and
  instalment mixes). Only compare like with like: same category, term, currency and insurance inclusion.
- Not collected: Banca Transilvania and other banks, current-account fee comparisons, anything behind a login.
