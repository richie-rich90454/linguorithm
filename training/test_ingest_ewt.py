"""The pinned EWT fetch path is API-independent and never accepts changed bytes."""

import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

from ingest_ewt import download_verified, ingest, read_manifest


class FakeResponse:
    def __init__(self, content):
        self.content = content

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def read(self):
        return self.content


class EwtIngestionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        (Path(__file__).parents[1] / ".cache").mkdir(exist_ok=True)

    def test_manifest_uses_immutable_raw_urls_without_api_calls(self):
        manifest = read_manifest()
        self.assertEqual(manifest["release"], "r2.16")
        self.assertTrue(
            all(
                "raw.githubusercontent.com/" in item["url"]
                for item in manifest["files"].values()
            )
        )
        self.assertTrue(
            all(
                "api.github.com" not in item["url"]
                for item in manifest["files"].values()
            )
        )

    def test_existing_verified_files_skip_all_network_requests(self):
        root = Path(__file__).parents[1]
        opener = Mock(side_effect=AssertionError("unexpected network request"))
        result = ingest(root, opener=opener)
        self.assertEqual(result["files"], 5)
        self.assertEqual(result["downloaded"], 0)
        self.assertEqual(result["verifiedExisting"], 5)
        opener.assert_not_called()

    def test_download_writes_only_after_hash_verification(self):
        content = b"pinned bytes"
        digest = hashlib.sha256(content).hexdigest()
        with tempfile.TemporaryDirectory(
            dir=Path(__file__).parents[1] / ".cache"
        ) as temp:
            destination = Path(temp) / "corpus.conllu"
            opener = Mock(return_value=FakeResponse(content))
            size = download_verified(
                "https://raw.githubusercontent.com/owner/repo/pinned/file",
                digest,
                destination,
                opener=opener,
                wait=Mock(),
            )
            self.assertEqual(size, len(content))
            self.assertEqual(destination.read_bytes(), content)
            self.assertFalse(destination.with_name("corpus.conllu.download").exists())

    def test_hash_mismatch_does_not_replace_an_existing_destination(self):
        with tempfile.TemporaryDirectory(
            dir=Path(__file__).parents[1] / ".cache"
        ) as temp:
            destination = Path(temp) / "corpus.conllu"
            destination.write_bytes(b"old valid destination")
            opener = Mock(return_value=FakeResponse(b"unexpected bytes"))
            with self.assertRaisesRegex(ValueError, "Pinned source hash mismatch"):
                download_verified(
                    "https://raw.githubusercontent.com/owner/repo/pinned/file",
                    "0" * 64,
                    destination,
                    opener=opener,
                    wait=Mock(),
                )
            self.assertEqual(destination.read_bytes(), b"old valid destination")


if __name__ == "__main__":
    unittest.main()
