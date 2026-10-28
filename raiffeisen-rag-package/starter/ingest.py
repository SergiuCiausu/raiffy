"""Embed the chunks and write a small numpy index to starter/index/.

    python starter/ingest.py                         # data/chunks.jsonl, multilingual-e5-base
    python starter/ingest.py --extra                 # also index data/optional/chunks_extra_pdf.jsonl
    python starter/ingest.py --embedder hash         # offline smoke test (poor quality, no downloads)

The index is deliberately simple (vectors.npy + chunks.jsonl + config.json). For production, load the same
chunks into a vector DB (pgvector, Qdrant, Chroma...) keeping `metadata` as filterable payload.
"""
from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path

import numpy as np

from common import DEFAULT_MODEL, load_jsonl, make_embedder

HERE = Path(__file__).resolve().parent
DATA = HERE.parent / "data"
log = logging.getLogger("ingest")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--chunks", type=Path, default=DATA / "chunks.jsonl")
    ap.add_argument("--extra", action="store_true", help="also index the optional prospectus PDF chunks")
    ap.add_argument("--embedder", choices=["st", "hash"], default="st")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--out", type=Path, default=HERE / "index")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    chunks = load_jsonl(args.chunks)
    if args.extra:
        chunks += load_jsonl(DATA / "optional" / "chunks_extra_pdf.jsonl")
    log.info("Embedding %d chunks with %s", len(chunks), args.embedder if args.embedder == "hash" else args.model)
    embedder = make_embedder(args.embedder, args.model)
    vectors = embedder.encode([c["text"] for c in chunks])

    args.out.mkdir(parents=True, exist_ok=True)
    np.save(args.out / "vectors.npy", vectors)
    with (args.out / "chunks.jsonl").open("w", encoding="utf-8") as fh:
        for c in chunks:
            fh.write(json.dumps(c, ensure_ascii=False) + "\n")
    (args.out / "config.json").write_text(json.dumps(
        {"embedder": args.embedder, "model": args.model, "n_chunks": len(chunks), "dim": int(vectors.shape[1])}))
    log.info("Index written to %s", args.out)


if __name__ == "__main__":
    main()
