"""Download the embedding models for the RAG benchmark, only the files sentence-transformers needs.

    python tools/rag/download_models.py intfloat/multilingual-e5-base intfloat/multilingual-e5-large BAAI/bge-m3

Set HF_HUB_DISABLE_XET=1 to force plain HTTP downloads (more reliable on some networks).
"""
from __future__ import annotations

import sys
import time

from huggingface_hub import snapshot_download

# Weights in safetensors when the repo has them, otherwise the PyTorch .bin; no ONNX/OpenVINO copies.
ALLOW = [
    "*.json",
    "*.txt",
    "*.model",
    "model.safetensors",
    "pytorch_model.bin",
    "1_Pooling/*",
]


def main(models: list[str]) -> int:
    for repo in models:
        start = time.time()
        print(f"downloading {repo} ...", flush=True)
        path = snapshot_download(repo_id=repo, allow_patterns=ALLOW)
        print(f"done {repo} in {time.time() - start:.0f}s -> {path}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
