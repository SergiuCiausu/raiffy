"""One local browser voice job. All recordings and transcripts are temporary."""
from __future__ import annotations

import io
import json
from pathlib import Path
import signal
import sys
import tempfile
import wave

from local import speak, transcribe

MAX_BYTES = 2 * 1024 * 1024
MAX_SAMPLES = 30 * 24000


def decode_recording(data: bytes, destination: Path):
    import av

    samples = 0
    with av.open(io.BytesIO(data)) as source, wave.open(str(destination), "wb") as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(24000)
        resampler = av.AudioResampler(format="s16", layout="mono", rate=24000)
        for frame in source.decode(audio=0):
            for chunk in resampler.resample(frame):
                kept = min(chunk.samples, MAX_SAMPLES - samples)
                target.writeframes(chunk.to_ndarray().tobytes()[:kept * 2])
                samples += kept
                if samples == MAX_SAMPLES:
                    return  # Cap the decoded clip, including browser timer/codec padding.
        for chunk in resampler.resample(None):
            kept = min(chunk.samples, MAX_SAMPLES - samples)
            target.writeframes(chunk.to_ndarray().tobytes()[:kept * 2])
            samples += kept
    if samples < 2400:
        raise ValueError("Recording is too short")


def main():
    # Let TemporaryDirectory clean up when the browser cancels its process group.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(1))
    data = sys.stdin.buffer.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError("Request too large")
    with tempfile.TemporaryDirectory(prefix="raiffy-voice-") as directory:
        output = Path(directory)
        if sys.argv[1:] == ["transcribe"]:
            audio = output / "recording.wav"
            decode_recording(data, audio)
            result = transcribe(audio, output=output)
            sys.stdout.write(json.dumps({"text": result["transcript"]}))
        elif sys.argv[1:] == ["speak"]:
            text = json.loads(data)["text"]
            if not isinstance(text, str) or not 1 <= len(text.strip()) <= 2000:
                raise ValueError("Invalid text")
            result = speak(text, output=output)
            sys.stdout.buffer.write(Path(result["audio"]).read_bytes())
        else:
            raise ValueError("Unknown operation")


if __name__ == "__main__":
    main()
