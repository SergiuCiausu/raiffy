import json
import unittest

from garrett import NoCredentialRedirect, validate_voice


class VoiceImportTest(unittest.TestCase):
    def fixture(self, header, payload=b"\0\0\0\0"):
        encoded = json.dumps(header).encode()
        return len(encoded).to_bytes(8, "little") + encoded + payload

    def test_accepts_a_bounded_safetensors_embedding(self):
        data = self.fixture({"speaker_wavs": {"dtype": "F32", "shape": [1], "data_offsets": [0, 4]}})
        self.assertEqual(validate_voice(data), data)

    def test_rejects_preview_audio_and_html_error_pages(self):
        for data in [b"RIFF" + bytes(60), b"<html>authentication required</html>", bytes(2 * 1024 * 1024 + 1)]:
            with self.assertRaises(ValueError):
                validate_voice(data)

    def test_rejects_empty_or_out_of_bounds_tensors(self):
        for header in [{}, {"speaker_wavs": {"data_offsets": [0, 100]}}]:
            with self.assertRaises(ValueError):
                validate_voice(self.fixture(header))

    def test_export_credentials_are_never_forwarded_to_redirects(self):
        self.assertIsNone(NoCredentialRedirect().redirect_request(None, None, 302, "", {}, "https://another-host.test"))
