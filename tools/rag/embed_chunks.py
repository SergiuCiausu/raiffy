"""Embed every chunk and write {id, embedding} lines for scripts/build-rag-import.ts.

    python tools/rag/embed_chunks.py --model intfloat/multilingual-e5-base \
        --chunks raiffeisen-rag-package/data/chunks.jsonl --out tools/rag/.cache/embeddings.jsonl
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from embedding import DEFAULT_MODEL, Embedder


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--chunks", type=Path, default=Path("raiffeisen-rag-package/data/chunks.jsonl"))
    ap.add_argument("--out", type=Path, default=Path("tools/rag/.cache/embeddings.jsonl"))
    args = ap.parse_args()

    chunks = [json.loads(line) for line in args.chunks.open(encoding="utf-8") if line.strip()]
    start = time.time()
    vectors = Embedder(args.model).encode([c["text"] for c in chunks], kind="passage", progress=True)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", encoding="utf-8") as fh:
        for chunk, vector in zip(chunks, vectors):
            fh.write(json.dumps({"id": chunk["id"], "model": args.model, "embedding": vector}) + "\n")
    print(f"{len(chunks)} chunks embedded with {args.model} in {time.time() - start:.0f}s -> {args.out}")


if __name__ == "__main__":
    main()
