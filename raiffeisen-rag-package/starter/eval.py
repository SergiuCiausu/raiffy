"""Retrieval regression test: does the expected source appear in the top-k for each question?

    python starter/eval.py            # k=5
    python starter/eval.py -k 3
    python starter/eval.py --questions starter/eval_questions_en.json
    python starter/eval.py --backend convex   # Raiffy hybrid search in Convex, scoped to each question track
Each question in eval_questions.json has `expected_url_contains` and `expected_text_contains`
(verified to exist in data/chunks.jsonl when the package was built). A question is a hit when some top-k
chunk matches both.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


class ConvexIndex:
    """Calls the `rag:search` action of a Convex deployment (CONVEX_URL, default the local one)."""

    def __init__(self, url: str) -> None:
        from convex import ConvexClient

        self.client = ConvexClient(url)

    def search(self, question: str, k: int = 5, track: str | None = None) -> list[dict]:
        hits = self.client.action("rag:search", {"question": question, "track": track or "personal", "k": k})
        return [{"text": h["text"], "metadata": {"url": h["url"]}} for h in hits]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("-k", type=int, default=5)
    ap.add_argument("--questions", type=Path, default=HERE / "eval_questions.json")
    ap.add_argument("--backend", choices=["numpy", "convex"], default="numpy")
    ap.add_argument("--convex-url", default=os.environ.get("CONVEX_URL", "http://127.0.0.1:3210"))
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    questions = json.loads(args.questions.read_text(encoding="utf-8"))
    if args.backend == "convex":
        index = ConvexIndex(args.convex_url)
    else:
        from query import Index

        index = Index()
    hits_n = 0
    for q in questions:
        if args.backend == "convex":
            # Convex search is always scoped to one track: the question's, or personal by default.
            hits = index.search(q["question"], args.k, q.get("track") if q.get("track") in ("personal", "business") else None)
        else:
            hits = index.search(q["question"], args.k)
        ok = any(q["expected_url_contains"] in (h["metadata"].get("url") or "")
                 and q["expected_text_contains"] in h["text"] for h in hits)
        hits_n += ok
        print(("HIT  " if ok else "MISS ") + q["question"])
    print(f"\nhit@{args.k}: {hits_n}/{len(questions)}")
    return 0 if hits_n == len(questions) else 1


if __name__ == "__main__":
    sys.exit(main())
