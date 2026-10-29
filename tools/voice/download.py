"""Download only the selected public weights, never the original unquantized ASR weights."""
from pathlib import Path
import argparse
import json
import os

# Regular resumable HTTPS also works on networks where Hugging Face's CAS/Xet stalls.
os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
os.environ.setdefault("HF_HUB_DOWNLOAD_TIMEOUT", "60")

from huggingface_hub import snapshot_download

ROOT = Path(__file__).resolve().parents[2]
LOCK = json.loads((Path(__file__).parent / "upstream.lock.json").read_text())

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("model", choices=["stt", "tts"])
    args = parser.parse_args()
    config = LOCK[args.model]
    snapshot_download(
        repo_id=config["repository"], revision=config["revision"], token=False,
        local_dir=ROOT / ".local/voice/models" / args.model,
        allow_patterns=["*.gguf", "README.md"] if args.model == "stt" else ["*.json", "*.safetensors", "README.md"],
        max_workers=2,
    )
