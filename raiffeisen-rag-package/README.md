# Raiffeisen Bank România — RAG data package

Public product information from raiffeisen.ro (scraped 2026-10-28), cleaned and chunked for a RAG chatbot.

**If you use Claude / Claude Code:** unzip, open the folder, and tell it to read `CLAUDE.md` first
(Claude Code reads it automatically). It explains the data, the known gaps, and how to build the RAG.

**If you work by hand:** read `SCHEMA.md`, then run the quick start below.

```
CLAUDE.md                          instructions for the AI assistant (also useful for humans)
SCHEMA.md                          chunk format and fields
data/chunks.jsonl                  3,750 chunks — embed this
data/optional/chunks_extra_pdf.jsonl   ~25,500 prospectus chunks (optional, mostly English)
data/products.json                 208 products, full structure
data/pdf_extracts/                 full extracted text of 391 PDFs
starter/                           reference ingest / query / eval code
```

```bash
pip install -r starter/requirements.txt
python starter/ingest.py
python starter/query.py "Ce dobândă are depozitul la termen pe 3 luni?"
python starter/eval.py
```

Important: the data is a snapshot (rates and campaigns change), the text is Romanian, and fees/eligibility are
missing for most products — see "Known gaps" in `CLAUDE.md`. Content is Raiffeisen's public website material;
keep source URLs as citations.
