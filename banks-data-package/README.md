# Raiffeisen, ING and BCR: product data

What is inside:

| Path | What |
|---|---|
| `CLAUDE.md` | instructions for an AI coding assistant working with this data |
| `SCHEMA.md` | field-by-field description of the data (read this first) |
| `data/chunks.jsonl` | 10,100 text chunks with metadata, ready to embed |
| `data/raiffeisen/`, `data/ing/`, `data/bcr/` | structured product records (`products.json`, `products.csv`) |
| `data/comparison/` | presentation comparison (`comparatie.html` opens in a browser, `comparatie.csv`) |

Snapshot of public web pages collected on 2026-10-28. Not live data, and not financial advice.

Quick look:

```python
import json
chunks = [json.loads(l) for l in open("data/chunks.jsonl", encoding="utf-8")]
print(len(chunks), chunks[0]["text"][:200], chunks[0]["metadata"]["url"])
```

Data was collected politely (1 request/second, honoring each site's robots.txt) from public pages only.
