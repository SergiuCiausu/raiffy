"""Shared helpers: embedders, chunk loading, diacritic normalization."""
from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from pathlib import Path
from typing import Any

import numpy as np

DEFAULT_MODEL = "intfloat/multilingual-e5-base"


def unaccent(text: str) -> str:
    """Lowercase and strip Romanian diacritics ('dobândă' -> 'dobanda')."""
    nfkd = unicodedata.normalize("NFKD", text.lower())
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    with path.open(encoding="utf-8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


class HashEmbedder:
    """Offline char-n-gram hashing embedder. ONLY for smoke-testing the pipeline (quality is poor)."""

    dim = 2048

    def encode(self, texts: list[str], is_query: bool = False) -> np.ndarray:
        out = np.zeros((len(texts), self.dim), dtype=np.float32)
        for i, t in enumerate(texts):
            s = re.sub(r"\s+", " ", unaccent(t))
            for n in (3, 4):
                for j in range(len(s) - n + 1):
                    h = int(hashlib.md5(s[j:j + n].encode()).hexdigest()[:8], 16)
                    out[i, h % self.dim] += 1.0
        norms = np.linalg.norm(out, axis=1, keepdims=True)
        return out / np.maximum(norms, 1e-9)


class STEmbedder:
    """sentence-transformers wrapper; adds the e5 'query:'/'passage:' prefixes when the model is an e5 model."""

    def __init__(self, model: str) -> None:
        from sentence_transformers import SentenceTransformer

        self.model = SentenceTransformer(model)
        self.e5 = "e5" in model.lower()

    def encode(self, texts: list[str], is_query: bool = False) -> np.ndarray:
        if self.e5:
            prefix = "query: " if is_query else "passage: "
            texts = [prefix + t for t in texts]
        return np.asarray(self.model.encode(texts, batch_size=32, normalize_embeddings=True,
                                            show_progress_bar=not is_query), dtype=np.float32)


def make_embedder(kind: str, model: str):
    return HashEmbedder() if kind == "hash" else STEmbedder(model)
