"""Search the index with metadata filters, and build a grounded prompt for an LLM.

    python starter/query.py "Ce dobândă are depozitul la termen pe 3 luni?" --segment "persoane fizice" -k 5
    python starter/query.py "comisioane card" --section-type fees fee_table pdf --prompt
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np

from common import load_jsonl, make_embedder, unaccent

HERE = Path(__file__).resolve().parent

PROMPT_TEMPLATE = """Ești un asistent informativ despre produsele financiare Raiffeisen Bank România.
Răspunde DOAR pe baza fragmentelor de mai jos. Reguli:
- Nu inventa dobânzi, comisioane, condiții sau sume. Dacă informația nu apare în fragmente, spune clar că nu o ai
  și trimite utilizatorul la linkul oficial relevant.
- Citează sursa (URL) pentru fiecare afirmație importantă.
- Menționează că informațiile sunt din {scraped_at} și s-au putut schimba între timp; nu e consultanță financiară.
- Răspunde în limba întrebării.

FRAGMENTE:
{context}

ÎNTREBARE: {question}
"""


class Index:
    """In-memory cosine-similarity index with metadata filtering."""

    def __init__(self, path: Path = HERE / "index") -> None:
        self.cfg = json.loads((path / "config.json").read_text())
        self.vectors = np.load(path / "vectors.npy")
        self.chunks = load_jsonl(path / "chunks.jsonl")
        self.embedder = make_embedder(self.cfg["embedder"], self.cfg["model"])

    def search(self, question: str, k: int = 5, segment: str | None = None, category: str | None = None,
               currency: str | None = None, section_types: list[str] | None = None,
               doc_type: str | None = None) -> list[dict[str, Any]]:
        """Top-k chunks by cosine similarity after applying metadata filters (all optional)."""
        mask = np.ones(len(self.chunks), dtype=bool)
        for i, c in enumerate(self.chunks):
            m = c["metadata"]
            if segment and m.get("segment") != segment:
                mask[i] = False
            elif category and unaccent(category) not in unaccent(m.get("category") or ""):
                mask[i] = False
            elif currency and currency not in (m.get("currencies") or []):
                mask[i] = False
            elif section_types and m.get("section_type") not in section_types:
                mask[i] = False
            elif doc_type and m.get("doc_type") != doc_type:
                mask[i] = False
        q = self.embedder.encode([question], is_query=True)[0]
        scores = self.vectors @ q
        scores[~mask] = -1.0
        top = np.argsort(-scores)[:k]
        return [{**self.chunks[i], "score": float(scores[i])} for i in top if scores[i] > -1.0]


def build_prompt(question: str, hits: list[dict[str, Any]]) -> str:
    """Grounded prompt: numbered context fragments with their source URLs."""
    context = "\n\n".join(f"[{i}] (sursa: {h['metadata'].get('url')}; colectat: {h['metadata'].get('scraped_at', '')[:10]})\n"
                          f"{h['text']}" for i, h in enumerate(hits, 1))
    scraped = max((h["metadata"].get("scraped_at", "")[:10] for h in hits), default="2026-10-28") or "2026-10-28"
    return PROMPT_TEMPLATE.format(context=context, question=question, scraped_at=scraped)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("question")
    ap.add_argument("-k", type=int, default=5)
    ap.add_argument("--segment")
    ap.add_argument("--category")
    ap.add_argument("--currency")
    ap.add_argument("--section-type", nargs="*")
    ap.add_argument("--doc-type")
    ap.add_argument("--prompt", action="store_true", help="print the grounded prompt to send to an LLM")
    a = ap.parse_args()
    hits = Index().search(a.question, a.k, a.segment, a.category, a.currency, a.section_type, a.doc_type)
    if a.prompt:
        print(build_prompt(a.question, hits))
        return
    for h in hits:
        m = h["metadata"]
        print(f"{h['score']:.3f}  [{m.get('section_type')}] {m.get('product') or m.get('title')}  {m.get('url')}")
        print("   " + h["text"][:200].replace("\n", " | "))


if __name__ == "__main__":
    main()
