"""Compatibility launcher for the pinned Microsoft demo and its fixed, hash-checked voice preset."""
from __future__ import annotations

import hashlib
import io
import json
import os
from pathlib import Path
import runpy
import sys


def guarded_preset_loader(original_load, preset: Path, expected_sha256: str):
    """Only this reviewed upstream preset may deserialize its custom Transformers cache classes."""
    def load(source, *args, **kwargs):
        if isinstance(source, (str, os.PathLike)) and Path(source).resolve() == preset.resolve():
            # Current PyTorch's weights-only reader cannot SETITEMS on the preset's ModelOutput.
            # Do not apply this compatibility path to uploaded or arbitrary .pt files.
            contents = preset.read_bytes()
            if hashlib.sha256(contents).hexdigest() != expected_sha256:
                raise ValueError("The upstream voice preset changed; refusing to deserialize it.")
            kwargs["weights_only"] = False
            # Deserialize the verified bytes, not a path that could change after the check.
            source = io.BytesIO(contents)
        return original_load(source, *args, **kwargs)
    return load


def main():
    import torch
    root = Path(__file__).resolve().parents[2]
    source = root / ".local/voice/vendor/VibeVoice"
    lock = json.loads((Path(__file__).parent / "upstream.lock.json").read_text())
    preset = source / lock["ttsPreset"]["path"]
    torch.load = guarded_preset_loader(torch.load, preset, lock["ttsPreset"]["sha256"])
    script = source / "demo/realtime_model_inference_from_file.py"
    sys.argv[0] = str(script)
    runpy.run_path(str(script), run_name="__main__")


if __name__ == "__main__":
    main()
