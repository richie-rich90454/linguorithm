"""Dictionary ingestion is pinned, project-local, and independent of GitHub's API."""

import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

from ingest_dictionary import DATA_DIRECTORY, ingest, read_manifest, raw_url


class FakeResponse:
    def __init__(self, content):
        self.content = content

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def read(self):
        return self.content


class DictionaryIngestionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        (Path(__file__).parents[1] / ".cache").mkdir(exist_ok=True)

    def fixture(self, root):
        commit = "a" * 40
        files = []
        payloads = {}
        for name, content in {
            "index.dic": b"2\nword/AB\nother/C\n",
            "index.aff": b"SET UTF-8\n",
            "license": b"MIT and BSD notices\n",
            "readme.md": b"Dictionary provenance\n",
        }.items():
            payloads[name] = content
            files.append(
                {
                    "path": f"{DATA_DIRECTORY}/{name}",
                    "sha256": hashlib.sha256(content).hexdigest(),
                    "gitBlobSha": "b" * 40,
                    "bytes": len(content),
                    "source": (
                        "https://github.com/wooorm/dictionaries/blob/"
                        f"{commit}/dictionaries/en/{name}"
                    ),
                }
            )
        directory = root / "training/datasets"
        directory.mkdir(parents=True)
        (directory / "dictionary-manifest.json").write_text(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "id": "scowl-en-US-60",
                    "repositoryCommit": commit,
                    "files": files,
                }
            ),
            encoding="utf-8",
        )
        return payloads

    def test_checked_in_manifest_resolves_only_immutable_raw_urls(self):
        root = Path(__file__).parents[1]
        manifest = read_manifest(root)
        self.assertEqual(len(manifest["files"]), 4)
        for record in manifest["files"]:
            url = raw_url(record)
            self.assertTrue(url.startswith("https://raw.githubusercontent.com/"))
            self.assertIn(manifest["repositoryCommit"], url)
            self.assertNotIn("api.github.com", url)

    def test_verified_project_local_files_skip_network(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parents[1] / ".cache") as temp:
            root = Path(temp)
            payloads = self.fixture(root)
            directory = root / DATA_DIRECTORY
            directory.mkdir(parents=True)
            for name, content in payloads.items():
                (directory / name).write_bytes(content)
            opener = Mock(side_effect=AssertionError("unexpected network request"))
            result = ingest(root, opener=opener)
            self.assertEqual(result["files"], 4)
            self.assertEqual(result["downloaded"], 0)
            self.assertEqual(result["verifiedExisting"], 4)
            opener.assert_not_called()

    def test_missing_files_download_from_raw_urls_and_verify_before_writing(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parents[1] / ".cache") as temp:
            root = Path(temp)
            payloads = self.fixture(root)
            responses = [FakeResponse(payloads[name]) for name in payloads]
            opener = Mock(side_effect=responses)
            result = ingest(root, opener=opener, wait=Mock())
            self.assertEqual(result["downloaded"], 4)
            self.assertEqual(result["verifiedExisting"], 0)
            requested_urls = [call.args[0].full_url for call in opener.call_args_list]
            self.assertTrue(all("raw.githubusercontent.com/" in url for url in requested_urls))
            self.assertTrue(all("api.github.com" not in url for url in requested_urls))
            for name, content in payloads.items():
                self.assertEqual((root / DATA_DIRECTORY / name).read_bytes(), content)

    def test_modified_cached_file_is_rejected(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parents[1] / ".cache") as temp:
            root = Path(temp)
            self.fixture(root)
            directory = root / DATA_DIRECTORY
            directory.mkdir(parents=True)
            (directory / "index.dic").write_bytes(b"tampered")
            with self.assertRaisesRegex(ValueError, "Pinned dictionary hash or size mismatch"):
                ingest(root, opener=Mock())

    def test_manifest_rejects_unpinned_or_escaping_source_paths(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parents[1] / ".cache") as temp:
            root = Path(temp)
            self.fixture(root)
            manifest_path = root / "training/datasets/dictionary-manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["files"][0]["path"] = "../outside/index.dic"
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "escapes the reviewed data directory"):
                read_manifest(root)

    def test_ingest_rejects_data_directory_symlink_outside_project(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parents[1] / ".cache") as temp:
            base = Path(temp)
            root = base / "project"
            root.mkdir()
            self.fixture(root)
            outside = base / "external-data"
            outside.mkdir()
            raw = root / "training/datasets/raw"
            raw.mkdir(parents=True)
            link = raw / "dictionary"
            try:
                link.symlink_to(outside, target_is_directory=True)
            except (NotImplementedError, OSError) as error:
                self.skipTest(f"directory symlinks are unavailable: {error}")

            with self.assertRaisesRegex(ValueError, "data directory escapes"):
                ingest(root, opener=Mock())

    def test_ingest_rejects_dictionary_file_symlink_outside_data_directory(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parents[1] / ".cache") as temp:
            base = Path(temp)
            root = base / "project"
            root.mkdir()
            self.fixture(root)
            directory = root / DATA_DIRECTORY
            directory.mkdir(parents=True)
            outside = base / "external-index.dic"
            outside.write_bytes(b"outside project data")
            try:
                (directory / "index.dic").symlink_to(outside)
            except (NotImplementedError, OSError) as error:
                self.skipTest(f"file symlinks are unavailable: {error}")

            with self.assertRaisesRegex(ValueError, "target escapes"):
                ingest(root, opener=Mock())


if __name__ == "__main__":
    unittest.main()
