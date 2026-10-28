# Working with the bank product data

You are helping build a feature on top of public product data from three Romanian banks: Raiffeisen, ING and BCR.
Read `SCHEMA.md` first, then look at 3-5 lines of `data/chunks.jsonl` before writing any code.

## Facts about the data

- 10,100 chunks (bcr 4,283, ing 2,067, raiffeisen 3,750); Romanian text with inconsistent diacritics ("dobanda" and "dobândă" both occur).
- Snapshot of 2026-10-28. Treat every number as dated: carry `metadata.scraped_at` and `metadata.url` through to the answer.
- Chunks are self-contained: each starts with the bank, product, category and segment.
- `data/<bank>/products.json` holds the structured source the chunks were built from.

## Rules that matter

1. **Do not let a language model produce rates, fees or amounts from memory or paraphrase.** Retrieve, quote, and cite
   `metadata.url` and the date. If it is not in the data, say so and point to the bank's official page.
2. **Do not compare banks on non-comparable figures.** Match category, term, currency and insurance. Credit-card APR
   examples, "from X%" rates and campaign rates have different assumptions; show the conditions next to the number.
3. **Respect the known gaps** in `SCHEMA.md` (ING has no PDFs; many structured fields are empty). Missing is not zero:
   never turn an empty fee field into "no fee".
4. Filter before similarity search: `bank`, `segment`, `category`, `currencies`, `section_type`, and exclude
   `status == "withdrawn"` for current offers.
5. Use a multilingual embedding model (Romanian). Hybrid (vector + keyword) search works better than vectors alone
   because product names and numbers matter.
6. Keep numbers out of the embedded FAQ text if you build a catalog: store rates and fees as typed, dated records
   (`value`, `validFrom`, `sourceUrl`) and use the chunks only for explanations.

## Verify your work

Build a small question set from the data itself (for example 10 questions whose answer you can find by hand in
`chunks.jsonl`, across all three banks) and check that retrieval returns the right source URL in the top 5 before
building anything on top. `data/comparison/comparatie.csv` has hand-checked figures you can use as test answers.

## Do not

- Do not re-scrape the banks' websites to "refresh" this data without asking the owner: collection is rate-limited
  and was done on purpose. ING's robots.txt forbids PDF downloads.
- Do not present the data as official or current; it is a dated copy of public pages.
