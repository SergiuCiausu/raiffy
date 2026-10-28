"""Retrieval regression test: does the expected source appear in the top-k for each question?

    python starter/eval.py            # k=5
    python starter/eval.py -k 3
Each question in eval_questions.json has `expected_url_contains` and `expected_text_contains`
(verified to exist in data/chunks.jsonl when the package was built). A question is a hit when some top-k
chunk matches both.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from query import Index

HERE = Path(__file__).resolve().parent


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("-k", type=int, default=5)
    args = ap.parse_args()
    questions = json.loads((HERE / "eval_questions.json").read_text(encoding="utf-8"))
    index = Index()
    hits_n = 0
    for q in questions:
        hits = index.search(q["question"], args.k)
        ok = any(q["expected_url_contains"] in (h["metadata"].get("url") or "")
                 and q["expected_text_contains"] in h["text"] for h in hits)
        hits_n += ok
        print(("HIT  " if ok else "MISS ") + q["question"])
    print(f"\nhit@{args.k}: {hits_n}/{len(questions)}")
    return 0 if hits_n == len(questions) else 1


if __name__ == "__main__":
    sys.exit(main())
