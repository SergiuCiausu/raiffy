import hashlib
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock

from tts import guarded_preset_loader


class PresetLoaderTest(unittest.TestCase):
    def test_only_exact_pinned_bytes_use_compatibility_mode(self):
        with tempfile.TemporaryDirectory() as directory:
            preset = Path(directory) / "reviewed.pt"
            preset.write_bytes(b"reviewed upstream fixture")
            original = Mock(return_value="loaded")
            load = guarded_preset_loader(original, preset, hashlib.sha256(preset.read_bytes()).hexdigest())
            self.assertEqual(load(str(preset), weights_only=True), "loaded")
            original.assert_called_once()
            self.assertEqual(original.call_args.args[0].getvalue(), b"reviewed upstream fixture")
            self.assertEqual(original.call_args.kwargs, {"weights_only": False})

    def test_modified_preset_fails_before_deserialization(self):
        with tempfile.TemporaryDirectory() as directory:
            preset = Path(directory) / "reviewed.pt"
            preset.write_bytes(b"modified bytes")
            original = Mock()
            load = guarded_preset_loader(original, preset, hashlib.sha256(b"reviewed upstream fixture").hexdigest())
            with self.assertRaises(ValueError):
                load(str(preset), weights_only=True)
            original.assert_not_called()

    def test_other_files_and_streams_keep_their_original_load_policy(self):
        original = Mock()
        load = guarded_preset_loader(original, Path("/reviewed/preset.pt"), "unused")
        load("/untrusted/upload.pt", weights_only=True)
        original.assert_called_with("/untrusted/upload.pt", weights_only=True)
        stream = io.BytesIO(b"untrusted stream")
        load(stream, weights_only=True)
        original.assert_called_with(stream, weights_only=True)


if __name__ == "__main__":
    unittest.main()
