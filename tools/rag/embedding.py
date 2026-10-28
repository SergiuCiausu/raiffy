"""Shared embedding helper: the same model and prefixes for chunks (passages) and questions (queries)."""
from __future__ import annotations

from sentence_transformers import SentenceTransformer

DEFAULT_MODEL = "intfloat/multilingual-e5-base"


class Embedder:
    def __init__(self, model: str = DEFAULT_MODEL) -> None:
        self.name = model
        self.model = SentenceTransformer(model)
        # e5 models expect "query: " / "passage: " prefixes; bge-m3 takes raw text.
        self.e5 = "e5" in model.lower()

    def encode(self, texts: list[str], kind: str, batch_size: int = 32, progress: bool = False) -> list[list[float]]:
        if self.e5:
            prefix = "query: " if kind == "query" else "passage: "
            texts = [prefix + t for t in texts]
        vectors = self.model.encode(texts, batch_size=batch_size, normalize_embeddings=True,
                                    show_progress_bar=progress)
        return vectors.tolist()
