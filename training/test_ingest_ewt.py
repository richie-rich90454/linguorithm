"""The pinned EWT fetch path is API-independent and never accepts changed bytes."""

import hashlib
import tempfile
import unittest
from pathlib import Path
from urllib.error import HTTPError
from unittest.mock import Mock

from ingest_ewt import download_verified, ingest, read_manifest, retry_delay


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

    def test_github_rate_limit_403_retries_using_server_retry_after(self):
        content = b"pinned bytes after rate limit"
        digest = hashlib.sha256(content).hexdigest()
        limited = HTTPError(
            "https://api.github.com/resource",
            403,
            "rate limit exceeded",
            {"X-RateLimit-Remaining": "0", "Retry-After": "7"},
            None,
        )
        with tempfile.TemporaryDirectory(
            dir=Path(__file__).parents[1] / ".cache"
        ) as temp:
            destination = Path(temp) / "corpus.conllu"
            opener = Mock(side_effect=[limited, FakeResponse(content)])
            wait = Mock()
            download_verified(
                "https://raw.githubusercontent.com/owner/repo/pinned/file",
                digest,
                destination,
                opener=opener,
                wait=wait,
            )
            self.assertEqual(destination.read_bytes(), content)
            wait.assert_called_once_with(7)
            self.assertEqual(opener.call_count, 2)

    def test_ordinary_github_forbidden_response_fails_without_retry(self):
        denied = HTTPError(
            "https://raw.githubusercontent.com/owner/repo/pinned/file",
            403,
            "access denied",
            {},
            None,
        )
        wait = Mock()
        with tempfile.TemporaryDirectory(
            dir=Path(__file__).parents[1] / ".cache"
        ) as temp:
            with self.assertRaisesRegex(RuntimeError, "raw-file host denied"):
                download_verified(
                    "https://raw.githubusercontent.com/owner/repo/pinned/file",
                    "0" * 64,
                    Path(temp) / "corpus.conllu",
                    opener=Mock(side_effect=denied),
                    wait=wait,
                )
        wait.assert_not_called()

    def test_rate_limit_retry_honors_reset_timestamp_and_bounds_delay(self):
        limited = HTTPError(
            "https://api.github.com/resource",
            403,
            "rate limit exceeded",
            {"X-RateLimit-Remaining": "0", "X-RateLimit-Reset": "10000"},
            None,
        )
        self.assertEqual(retry_delay(limited, 3, now=9970), 30)
        self.assertEqual(retry_delay(limited, 3, now=900), 3600)

    def test_ingest_rejects_data_directory_symlink_outside_project(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parents[1] / ".cache") as temp:
            base = Path(temp)
            root = base / "project"
            datasets = root / "training/datasets"
            datasets.mkdir(parents=True)
            source_manifest = Path(__file__).parents[1] / "training/datasets/ewt-manifest.json"
            (datasets / "ewt-manifest.json").write_bytes(source_manifest.read_bytes())
            outside = base / "external-data"
            outside.mkdir()
            raw = datasets / "raw"
            raw.mkdir()
            link = raw / "ewt"
            try:
                link.symlink_to(outside, target_is_directory=True)
            except (NotImplementedError, OSError) as error:
                self.skipTest(f"directory symlinks are unavailable: {error}")

            with self.assertRaisesRegex(ValueError, "data directory escapes"):
                ingest(root, opener=Mock())

    def test_ingest_rejects_corpus_file_symlinks_outside_data_directory(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parents[1] / ".cache") as temp:
            base = Path(temp)
            root = base / "project"
            datasets = root / "training/datasets"
            datasets.mkdir(parents=True)
            source_manifest = Path(__file__).parents[1] / "training/datasets/ewt-manifest.json"
            (datasets / "ewt-manifest.json").write_bytes(source_manifest.read_bytes())
            outside = base / "external-data"
            outside.mkdir()
            destination = datasets / "raw/ewt"
            destination.mkdir(parents=True)
            manifest = read_manifest(datasets / "ewt-manifest.json")
            try:
                for name in manifest["files"]:
                    external_file = outside / name
                    external_file.write_bytes(b"outside project data")
                    (destination / name).symlink_to(external_file)
            except (NotImplementedError, OSError) as error:
                self.skipTest(f"file symlinks are unavailable: {error}")

            with self.assertRaisesRegex(ValueError, "target escapes"):
                ingest(root, opener=Mock())


if __name__ == "__main__":
    unittest.main()
