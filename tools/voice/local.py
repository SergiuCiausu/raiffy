"""Run VibeVoice speech tests on this machine; never connects to Convex or paid APIs."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
SANDBOX = ROOT / ".local/voice"
OUTPUT = SANDBOX / "outputs"
LOCK = json.loads((Path(__file__).parent / "upstream.lock.json").read_text())


def ready(path: Path):
    if not path.exists():
        raise SystemExit(f"Missing {path}. Run pnpm voice:setup first.")
    return path


def save_result(name: str, result: dict, output: Path = OUTPUT):
    output.mkdir(parents=True, exist_ok=True)
    (output / f"{name}.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    return result


def transcribe(path: Path, threads: int = 4, output: Path = OUTPUT):
    audio = path.expanduser().resolve(strict=True)
    if audio.suffix.lower() != ".wav":
        raise SystemExit("This local test expects WAV audio. Convert other formats first.")
    executable = ready(SANDBOX / "vendor/VibeASR.cpp/build/bin/asr_infer")
    models = SANDBOX / "models/stt"
    command = [str(executable), "--vae-model", str(ready(models / "vibeasr-vae-encoder-i8_s.gguf")),
               "--lm-model", str(ready(models / "vibeasr-lm-i2_s-embed-q6_k.gguf")),
               "--audio", str(audio), "-t", str(threads), "--greedy", "--max-tokens", "512", "-c", "4096"]
    output.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    with (output / "stt.log").open("w") as log:
        run = subprocess.run(command, stdout=subprocess.PIPE, stderr=log, text=True, timeout=180)
    if run.returncode:
        raise SystemExit(f"Speech recognition failed. See {output / 'stt.log'}")
    transcript = run.stdout.strip()
    if not transcript:
        raise SystemExit(f"No transcript returned. See {output / 'stt.log'}")
    log = (output / "stt.log").read_text()
    duration = re.search(r"Audio: ([\d.]+)s", log)
    inference = re.search(r"Total:\s+([\d.]+) ms", log)
    result = {
        "model": LOCK["stt"]["repository"], "revision": LOCK["stt"]["revision"], "device": "cpu",
        "input": str(audio), "transcript": transcript, "elapsedSecondsIncludingLoad": round(time.monotonic() - started, 3),
        "audioSeconds": float(duration[1]) if duration else None,
        "inferenceSecondsExcludingLoad": round(float(inference[1]) / 1000, 4) if inference else None,
    }
    save_result(f"stt-{audio.stem}", result, output)
    return save_result("stt", result, output)


def speak(text: str, device: str = "mps", speaker: str = "Carter", output: Path = OUTPUT):
    if not text.strip() or len(text) > 2000:
        raise SystemExit("Supply 1–2000 characters for the local speech test.")
    python = ready(SANDBOX / "venv/bin/python")
    source = ready(SANDBOX / "vendor/VibeVoice")
    model = ready(SANDBOX / "models/tts/model.safetensors").parent
    output.mkdir(parents=True, exist_ok=True)
    script = output / "speech-input.txt"
    script.write_text(text.strip() + "\n")
    command = [str(python), "-u", str(Path(__file__).parent.resolve() / "tts.py"),
               "--model_path", str(model), "--txt_path", str(script), "--speaker_name", speaker,
               "--output_dir", str(output), "--device", device]
    started = time.monotonic()
    with (output / "tts.log").open("w") as log:
        run = subprocess.run(command, cwd=source, stdout=log, stderr=subprocess.STDOUT, timeout=300,
                             env={**os.environ, "HF_HUB_DISABLE_XET": "1", "HF_HUB_DOWNLOAD_TIMEOUT": "60"})
    if run.returncode:
        raise SystemExit(f"Speech generation failed. See {output / 'tts.log'}")
    audio = ready(output / "speech-input_generated.wav")
    log = (output / "tts.log").read_text()
    duration = re.search(r"Generated audio duration: ([\d.]+) seconds", log)
    inference = re.search(r"Generation time: ([\d.]+) seconds", log)
    actual_device = re.search(r"Using device: (mps|cpu|cuda)", log)
    return save_result("tts", {
        "model": LOCK["tts"]["repository"], "revision": LOCK["tts"]["revision"], "requestedDevice": device,
        "actualDevice": actual_device[1] if actual_device else "unmeasured",
        "text": text.strip(), "speaker": speaker, "audio": str(audio),
        "elapsedSecondsIncludingLoad": round(time.monotonic() - started, 3),
        "audioSeconds": float(duration[1]) if duration else None,
        "inferenceSecondsExcludingLoad": float(inference[1]) if inference else None,
    }, output)


def smoke():
    if platform.system() != "Darwin":
        raise SystemExit("The synthetic microphone fixture uses macOS say. Use voice:transcribe with your own WAV elsewhere.")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    phrase = "I am saving for a car over the next two years."
    aiff = OUTPUT / "synthetic-input.aiff"
    wav = OUTPUT / "synthetic-input.wav"
    subprocess.run(["say", "-v", "Samantha", "-o", str(aiff), phrase], check=True)
    subprocess.run(["afconvert", "-f", "WAVE", "-d", "LEI16@24000", "-c", "1", str(aiff), str(wav)], check=True)
    stt = transcribe(wav)
    normalized = re.sub(r"[^a-z0-9 ]", " ", stt["transcript"].lower())
    if not all(word in normalized.split() for word in ["saving", "car", "years"]):
        raise SystemExit(f"STT did not preserve the synthetic fixture's key words: {stt['transcript']}")
    tts = speak("Hello. I am Raiffy, your banking assistant. How can I help you today?")
    # Models run sequentially; no overlapping Python/C++ model processes on a 16 GB Mac.
    roundtrip = transcribe(Path(tts["audio"]))
    normalized_roundtrip = re.sub(r"[^a-z0-9 ]", " ", roundtrip["transcript"].lower())
    if not all(word in normalized_roundtrip.split() for word in ["hello", "banking", "help", "today"]):
        raise SystemExit(f"Generated speech failed the synthetic round-trip check: {roundtrip['transcript']}")
    report = save_result("smoke", {"syntheticFixture": True, "stt": stt, "tts": tts, "ttsRoundTrip": roundtrip})
    print(json.dumps(report, ensure_ascii=False, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    stt = commands.add_parser("transcribe")
    stt.add_argument("audio", type=Path)
    stt.add_argument("--threads", type=int, choices=range(1, 9), default=4)
    tts = commands.add_parser("speak")
    tts.add_argument("text")
    tts.add_argument("--device", choices=["mps", "cpu", "cuda"], default="mps" if platform.system() == "Darwin" else "cpu")
    tts.add_argument("--speaker", choices=["Carter"], default="Carter")
    commands.add_parser("smoke")
    args = parser.parse_args()
    if args.command == "transcribe":
        print(json.dumps(transcribe(args.audio, args.threads), ensure_ascii=False, indent=2))
    elif args.command == "speak":
        print(json.dumps(speak(args.text, args.device, args.speaker), ensure_ascii=False, indent=2))
    else:
        smoke()


if __name__ == "__main__":
    main()
