# CLAUDE.md — Raiffeisen Bank România RAG data package

You are helping build a **RAG chatbot about Raiffeisen Bank Romania's public financial products**
(accounts, cards, loans, deposits, investments, insurance, payments; for individuals, SMEs, corporate,
private/premium banking). This package contains the already-scraped, already-chunked data. **Your job is to
index it and build retrieval + grounded answering on top. You do not need to scrape anything.**

## Read in this order
1. This file.
2. `SCHEMA.md` — field-by-field description of `chunks.jsonl` (authoritative).
3. `data/chunks.jsonl` — peek at ~5 lines (`head -n 5`) to see real chunks. Do not load the whole file into context.
4. `starter/` — working reference ingest/query/eval code. Reuse it or replace parts.

## What is in the package

| Path | What | Use |
|---|---|---|
| `data/chunks.jsonl` | **3,750 chunks**, one JSON object per line, ~1M tokens | **Embed this.** Primary index |
| `data/optional/chunks_extra_pdf.jsonl` | ~25,500 chunks from IPO prospectuses / structured products (many in English) | Skip by default. Add only if the bot must answer investment/issuance questions; index it as a *separate collection* |
| `data/products.json` | 208 products, full nested structure | Exact lookups, product list, tables; not for embedding |
| `data/pdf_extracts/` | Full text/tables of 391 PDFs | Source for re-chunking PDFs differently |
| `starter/ingest.py`, `query.py`, `eval.py` | Reference pipeline (numpy index, metadata filters, grounded-prompt builder) | Quick start |
| `starter/eval_questions.json` | 8 questions with verified answers + expected source URL | Regression test for retrieval |

## Chunk shape
```json
{"id": "...#fees-3",
 "text": "<Product> — <Category> (<segment>)\n<heading>\n<body>",
 "metadata": {"source_type": "product_page|pdf", "section_type": "...", "product": "...", "segment": "...",
              "category": "...", "currencies": ["RON"], "url": "https://www.raiffeisen.ro/...", "scraped_at": "..."}}
```
- **Embed `text` only.** `metadata` is for filtering and citations.
- Every chunk already starts with product name + category + segment, so it is self-contained.
- `segment` ∈ `persoane fizice`, `IMM`, `corporate`, `private banking`, `premium banking`.
- `section_type` ∈ `overview, features, description, fees, fee_table, interest_rates, eligibility,
  required_documents, faq, representative_example, pdf`.
- Chunks are ≤ ~2,000 characters (~450 tokens), median ~1,100.

## Language
Content is **Romanian**, and the site uses diacritics inconsistently (`dobanda` vs `dobândă`, `si` vs `și`).
- Use a **multilingual** embedding model with good Romanian support (e.g. `intfloat/multilingual-e5-base` or
  `-large`, or a hosted multilingual embedding API). English-only models will do poorly.
- Normalize diacritics at query time (and consider adding a lexical/BM25 leg on diacritic-stripped text). Hybrid
  search (dense + BM25) helps a lot for exact terms like product names, "DAE", "Fresh Money".
- Answer in the user's language (most users will write Romanian).
- e5 models need prefixes: `"passage: "` for chunks, `"query: "` for questions (the starter does this).

## Recommended design (not mandatory)
1. **Filtering before similarity**: detect segment/category/currency from the question when obvious
   ("cardul meu de credit", "pentru firma mea" → IMM/corporate) and filter on metadata. If unsure, don't filter.
2. **Retrieve ~8–10, rerank/trim to ~4–5** chunks. Include `section_type in {fees, fee_table, interest_rates}`
   and PDFs with `doc_type=tarife` for cost questions.
3. **Grounded generation**: answer ONLY from retrieved chunks; cite `metadata.url` for each claim; show
   `scraped_at` ("informații din <date>"). `starter/query.py:build_prompt` gives a ready template.
4. **Refuse to guess numbers.** If the context lacks the value, say so and link the official page/tariff PDF.

## Known gaps — design around these, do NOT paper over them
- **Fees/commissions, eligibility and required documents are missing for most products** on the website pages
  (≈85–94% lack a dedicated section). Full commissions live in shared tariff PDFs (chunks with
  `doc_type: tarife`) that are *not* attributed to a specific product. A question like "ce comision are cardul X?"
  often cannot be answered exactly: the bot must say so and cite the tariff PDF URL.
- **Interest rates are structured for only one deposit page** (`Depozite la termen`); other rates appear only in
  free text or the representative-example chunk (`representative_example`, includes DAE, monthly payment, total).
- **Snapshot, not live**: scraped 2026-10-28. Rates and campaigns change often. Always surface `scraped_at`.
  Never present rates as current guarantees.
- PDF text is raw extraction; tables may be linearized. Verify on real questions before trusting.
- Pages that were redirects, category hubs and educational articles were intentionally excluded.
- 208 products only; some product pages are marketing-heavy and short.

## Quality bar / acceptance
- Run `python starter/eval.py`. All 8 questions in `starter/eval_questions.json` should retrieve the expected
  source in the top 5 (the starter's default embedding model should pass most; the offline `hash` embedder will
  not — it is only a plumbing smoke test).
- Add your own questions to that file as you go, covering: cost/fee questions (expect "not available, see PDF"),
  cross-segment ambiguity, English queries, typos/no-diacritics queries.
- The bot must never invent a rate, fee or eligibility rule that is not in a retrieved chunk.

## Legal / usage
Content is Raiffeisen Bank România's **public** website material. Keep source citations (`url`), and check the
site's terms before deploying publicly. This is not financial advice; the bot should say it is informational
and point to the bank's official channels for binding offers.

## Quick start
```bash
pip install -r starter/requirements.txt
python starter/ingest.py                 # builds starter/index/ (downloads the embedding model on first run)
python starter/query.py "Ce dobândă are depozitul la termen pe 3 luni?" --segment "persoane fizice"
python starter/eval.py
```
