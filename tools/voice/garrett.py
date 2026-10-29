"""Import Garrett's Phonon embedding. The optional authenticated download never synthesizes text."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
VOICE_ID = "POBHtemksfWQbng0"
DESTINATION = ROOT / "web/public/voices" / f"{VOICE_ID}.safetensors"
# Exact export workflow published in Gradium's scripts/download-voice.py.
EXPORT_URL = f"https://api.gradium.ai/api/voices/embeddings/{VOICE_ID}/default/blob?as_safetensors=1"
MAX_BYTES = 2 * 1024 * 1024


class NoCredentialRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        # Never forward the API key to a redirect destination.
        return None


def validate_voice(data: bytes):
    if len(data) < 16 or len(data) > MAX_BYTES:
        raise ValueError("Expected a Phonon .safetensors voice file under 2 MB.")
    header_size = int.from_bytes(data[:8], "little")
    if not 2 <= header_size <= min(65536, len(data) - 8):
        raise ValueError("Invalid safetensors header.")
    header = json.loads(data[8:8 + header_size])
    if not isinstance(header, dict):
        raise ValueError("Invalid safetensors header.")
    tensors = [value for name, value in header.items() if name != "__metadata__"]
    if not tensors:
        raise ValueError("The voice file contains no tensors.")
    payload = len(data) - 8 - header_size
    for tensor in tensors:
        offsets = tensor.get("data_offsets", []) if isinstance(tensor, dict) else []
        if len(offsets) != 2 or any(type(value) is not int for value in offsets) or not 0 <= offsets[0] < offsets[1] <= payload:
            raise ValueError("Invalid voice tensor offsets.")
    return data


def local_key():
    key = os.environ.get("GRADIUM_API_KEY", "").strip()
    if key:
        return key
    env = ROOT / ".env.local"
    for line in env.read_text().splitlines() if env.exists() else []:
        name, separator, value = line.partition("=")
        if separator and name.strip() == "GRADIUM_API_KEY":
            return value.strip().strip("\"'")
    raise ValueError("GRADIUM_API_KEY is absent. Import an exported file with --file, or add the key to .env.local for this one-time download.")


def install(data: bytes, source: str):
    validate_voice(data)
    DESTINATION.parent.mkdir(parents=True, exist_ok=True)
    temporary = DESTINATION.with_suffix(".tmp")
    temporary.write_bytes(data)
    temporary.replace(DESTINATION)
    manifest = {
        "name": "Garrett", "voiceId": VOICE_ID, "source": source,
        "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data),
        "importedAt": datetime.now(timezone.utc).isoformat(),
    }
    DESTINATION.with_suffix(".json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Installed Garrett: {DESTINATION} ({len(data):,} bytes)")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    choice = parser.add_mutually_exclusive_group(required=True)
    choice.add_argument("--file", type=Path, help="A Garrett export supplied by the owner; never a preview WAV")
    choice.add_argument("--download", action="store_true", help="Try Gradium's official authenticated voice export")
    args = parser.parse_args()
    try:
        if args.file:
            install(args.file.expanduser().read_bytes(), "owner-supplied Garrett export")
        else:
            request = urllib.request.Request(EXPORT_URL, headers={"x-api-key": local_key(), "Accept": "application/octet-stream"})
            opener = urllib.request.build_opener(NoCredentialRedirect())
            with opener.open(request, timeout=60) as response:
                install(response.read(MAX_BYTES + 1), EXPORT_URL)
    except urllib.error.HTTPError as error:
        raise SystemExit(f"Gradium rejected the Garrett export (HTTP {error.code}). No voice was installed. Catalog export may require access from Gradium.")
    except (OSError, ValueError) as error:
        raise SystemExit(str(error))


if __name__ == "__main__":
    main()
