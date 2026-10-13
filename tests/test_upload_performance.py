import io
import tempfile
import unittest
from pathlib import Path

import main


class UploadPerformanceTests(unittest.TestCase):
    def test_spooled_upload_is_copied_in_chunks(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "saved.bin"
            payload = b"a" * (2 * 1024 * 1024 + 17)
            size = main.persist_spooled_upload_limited(io.BytesIO(payload), str(target), len(payload) + 1)
            self.assertEqual(size, len(payload))
            self.assertEqual(target.read_bytes(), payload)
            self.assertFalse(list(Path(directory).glob("*.upload")))

    def test_oversized_upload_leaves_no_target_or_temp_file(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "saved.bin"
            with self.assertRaisesRegex(ValueError, "upload_too_large"):
                main.persist_spooled_upload_limited(io.BytesIO(b"x" * 2049), str(target), 2048)
            self.assertFalse(target.exists())
            self.assertFalse(list(Path(directory).glob("*.upload")))


if __name__ == "__main__":
    unittest.main()
