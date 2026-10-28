# Date RAG – Raiffeisen Bank România (produse financiare)

Sursa: pagini publice raiffeisen.ro, colectate cu `raiffeisen-scraper`. Limba: **română, cu diacritice** (paginile
folosesc inconsecvent diacriticele: „dobanda"/„dobândă" – folosiți un model de embedding multilingv și normalizați
interogările). Instantaneu, **nu date live**: dobânzile și campaniile se schimbă; vezi `metadata.scraped_at`.

## Format: `chunks.jsonl` (un obiect JSON pe linie)

| Câmp | Descriere |
|---|---|
| `id` | unic; `<produs>#<tip>-<n>` sau `pdf-<hash>#<n>` |
| `text` | **de embeduit**. Începe cu numele produsului/categoria/segmentul (chunk-ul e autonom) |
| `metadata.source_type` | `product_page` sau `pdf` |
| `metadata.section_type` | `overview`, `features`, `description`, `fees`, `fee_table`, `interest_rates`, `eligibility`, `required_documents`, `faq`, `representative_example`, `pdf` |
| `metadata.product`, `product_id` | numele produsului / slug stabil (doar `product_page`) |
| `metadata.segment` | `persoane fizice`, `IMM`, `corporate`, `private banking`, `premium banking` |
| `metadata.category`, `subcategory` | din breadcrumb (ex. „Carduri persoane fizice") |
| `metadata.currencies` | `RON`/`EUR`/`USD`/`CHF`/`GBP` detectate în text |
| `metadata.url` | pagina sau PDF-ul sursă – **afișați-l ca citare** |
| `metadata.scraped_at` | data colectării (ISO) |
| `metadata.doc_type`, `title`, `page_start`, `page_end`, `linked_products` | doar pentru `pdf` (`tarife`, `contract`, `fisa`, `regulament`, `ghid`, `termeni`, `altele`) |

## Fișiere

- `chunks.jsonl` – **fișierul principal**: pagini de produs + PDF-uri relevante (tarife, fișe, contracte, termeni, ghiduri,
  regulamente de campanii).
- `chunks_extra_pdf.jsonl` – opțional: PDF-uri „altele" (prospecte de ofertă publică, produse structurate, multe în
  engleză; ~90% din volum). Utile doar dacă botul trebuie să răspundă și despre investiții/emisiuni; altfel ignorați.

## Recomandări

- Filtrare înainte de similaritate: `segment`, `category`, `currencies`, `section_type` (ex. întrebări despre costuri →
  `section_type in {fees, fee_table, interest_rates, pdf}` cu `doc_type=tarife`).
- **Lacune cunoscute:** taxe/eligibilitate/documente lipsesc la majoritatea produselor în paginile web; comisioanele
  complete sunt în PDF-uri de tarife comune mai multor produse (chunk-uri `pdf`, fără atribuire pe produs). Botul nu
  trebuie să inventeze valori: să trimită la `metadata.url`.
- Chunk-urile `pdf` sunt text brut extras (pot avea tabele „liniarizate"); verificați-le pe interogări reale.
- Textele identice la ≥5 produse (boilerplate de tip „Motive să alegi Raiffeisen") au fost eliminate.
- Date publice ale băncii: păstrați citarea sursei și verificați termenii site-ului înainte de utilizare publică.

## Statistici de generare

```json
{
  "products": 208,
  "chunks_raw_products": 1839,
  "dropped_boilerplate_or_short": 45,
  "dropped_duplicates": 31,
  "total_chunks": 3750,
  "duplicate_ids": [],
  "by_section_type": {
    "overview": 202,
    "features": 187,
    "description": 957,
    "required_documents": 18,
    "faq": 332,
    "eligibility": 16,
    "fees": 19,
    "fee_table": 37,
    "representative_example": 5,
    "interest_rates": 3,
    "pdf": 1974
  },
  "by_segment": {
    "corporate": 389,
    "premium banking": 21,
    "private banking": 77,
    "IMM": 489,
    "persoane fizice": 800,
    "(pdf)": 1974
  },
  "chars_min_median_p95_max": [
    100,
    1116,
    1846,
    1980
  ],
  "approx_tokens_total": 1039637,
  "missing_url": 0,
  "extra_pdf_chunks_in_chunks_extra_pdf_jsonl": 25503
}
```
