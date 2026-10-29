"""Native macOS/Linux voice sandbox. Does not configure, start, or call Convex."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[2]
SANDBOX = ROOT / ".local/voice"
LOCK = json.loads((Path(__file__).parent / "upstream.lock.json").read_text())


def run(*args, cwd=ROOT):
    print("+ " + " ".join(str(arg) for arg in args), flush=True)
    subprocess.run([str(arg) for arg in args], cwd=cwd, check=True)


def checkout(key: str, name: str):
    config = LOCK[key]
    destination = SANDBOX / "vendor" / name
    if not destination.exists():
        run("git", "clone", "--filter=blob:none", "--no-checkout", config["repository"], destination)
        run("git", "fetch", "--depth", "1", "origin", config["revision"], cwd=destination)
        run("git", "checkout", "--detach", config["revision"], cwd=destination)
    actual = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=destination, text=True).strip()
    if actual != config["revision"]:
        raise SystemExit(f"{destination} differs from the pinned revision; existing checkout was preserved.")
    return destination


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", choices=["stt", "tts", "both"], default="both")
    args = parser.parse_args()
    if not shutil.which("uv"):
        raise SystemExit("Install uv first: https://docs.astral.sh/uv/getting-started/installation/")
    SANDBOX.mkdir(parents=True, exist_ok=True)
    (SANDBOX / "vendor").mkdir(exist_ok=True)
    python = SANDBOX / "venv/bin/python"
    if not python.exists():
        run("uv", "venv", "--python", "3.11", SANDBOX / "venv")
    run("uv", "pip", "install", "--python", python, "cmake>=3.20,<5", "huggingface-hub>=0.34,<2", "soundfile>=0.13,<1", "numpy>=1.26,<3")
    if args.only in ["stt", "both"]:
        source = checkout("vibeasr", "VibeASR.cpp")
        run("git", "submodule", "update", "--init", "--recursive", "--depth", "1", cwd=source)
        cmake = SANDBOX / "venv/bin/cmake"
        run(cmake, "-S", source, "-B", source / "build", "-DCMAKE_BUILD_TYPE=Release")
        run(cmake, "--build", source / "build", "--target", "asr_infer", "-j", "4")
        run(python, Path(__file__).parent / "download.py", "stt")
    if args.only in ["tts", "both"]:
        source = checkout("vibevoice", "VibeVoice")
        run("uv", "pip", "install", "--python", python, "torch==2.15.0", "-e", f"{source}[streamingtts]")
        run(python, Path(__file__).parent / "download.py", "tts")
    (SANDBOX / "upstream.lock.json").write_text(json.dumps(LOCK, indent=2) + "\n")
    print("Local voice setup ready. Models and generated audio stay under .local/voice/.")


if __name__ == "__main__":
    main()
