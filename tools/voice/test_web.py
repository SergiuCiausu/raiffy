"""Audio bounds in the isolated voice environment; no model inference required."""
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
import wave

from web import decode_recording


def fixture(seconds, rate=24000, channels=1):
    data = io.BytesIO()
    with wave.open(data, "wb") as audio:
        audio.setnchannels(channels)
        audio.setsampwidth(2)
        audio.setframerate(rate)
        audio.writeframes(bytes(int(seconds * rate) * channels * 2))
    return data.getvalue()


@unittest.skipUnless(importlib.util.find_spec("av"), "Run with .local/voice/venv/bin/python for PyAV guards")
class RecordingBoundsTest(unittest.TestCase):
    def test_resamples_browser_audio_to_bounded_mono_wav(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "recording.wav"
            decode_recording(fixture(1, rate=48000, channels=2), path)
            with wave.open(str(path)) as audio:
                self.assertEqual((audio.getnchannels(), audio.getsampwidth(), audio.getframerate()), (1, 2, 24000))
                self.assertEqual(audio.getnframes(), 24000)

    def test_codec_padding_or_delayed_browser_timer_cannot_exceed_thirty_seconds(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "recording.wav"
            decode_recording(fixture(31), path)
            with wave.open(str(path)) as audio:
                self.assertEqual(audio.getnframes(), 30 * 24000)

    def test_too_short_recordings_do_not_reach_inference(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "too short"):
                decode_recording(fixture(.01), Path(directory) / "recording.wav")


if __name__ == "__main__":
    unittest.main()
