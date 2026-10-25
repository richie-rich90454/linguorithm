"""OANC context ingestion reads only the selected written collections."""

import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock
from zipfile import ZipFile

from ingest_oanc import download_verified
from oanc_context import iter_written_sentences, plain_text, split_sentences
from training_stats import wilson_interval


class ChunkedResponse:
    def __init__(self, content):
        self.content = content
        self.position = 0

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def read(self, size=-1):
        if self.position >= len(self.content):
            return b""
        end = len(self.content) if size < 0 else self.position + size
        block = self.content[self.position : end]
        self.position = end
        return block


class OancContextTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        (Path(__file__).parents[1] / ".cache").mkdir(exist_ok=True)

    def test_html_xml_text_and_entities_are_extracted(self):
        actual = plain_text(
            b"<doc><p>Dr. Lee wrote, &quot;We met at 3.14 p.m.&quot; Then left.</p></doc>"
        )
        self.assertEqual(
            actual,
            'Dr. Lee wrote, "We met at 3.14 p.m." Then left.',
        )

    def test_sentence_splitting_preserves_abbreviations_and_decimals(self):
        sentences = list(
            split_sentences("Dr. Lee paid 3.14 dollars. He left at 4 p.m. Okay!")
        )
        self.assertEqual(
            sentences,
            [
                ["Dr", ".", "Lee", "paid", "3.14", "dollars", "."],
                ["He", "left", "at", "4", "p.m", "."],
                ["Okay", "!"],
            ],
        )

    def test_zip_reader_is_deterministic_written_only_and_keeps_document_groups(self):
        with tempfile.TemporaryDirectory(
            dir=Path(__file__).parents[1] / ".cache"
        ) as temp:
            archive_path = Path(temp) / "fixture.zip"
            with ZipFile(archive_path, "w") as archive:
                archive.writestr(
                    "OANC-GrAF/data/written_2/b.txt",
                    "Second written file. A second sentence!",
                )
                archive.writestr(
                    "OANC-GrAF/data/spoken/a.txt", "Spoken material is excluded."
                )
                archive.writestr(
                    "OANC-GrAF/data/written_1/a.txt",
                    "First written file. <p>Only this text is used.</p>",
                )
                archive.writestr("OANC-GrAF/data/written_1/a.xml", "Ignored annotation")
            manifest = {
                "selectedCollections": ["written_1", "written_2"],
                "selectedDocuments": 2,
            }
            actual = list(iter_written_sentences(archive_path, manifest))
            self.assertEqual(
                actual,
                [
                    (
                        "OANC-GrAF/data/written_1/a.txt",
                        ["First", "written", "file", "."],
                    ),
                    (
                        "OANC-GrAF/data/written_1/a.txt",
                        ["Only", "this", "text", "is", "used", "."],
                    ),
                    (
                        "OANC-GrAF/data/written_2/b.txt",
                        ["Second", "written", "file", "."],
                    ),
                    (
                        "OANC-GrAF/data/written_2/b.txt",
                        ["A", "second", "sentence", "!"],
                    ),
                ],
            )
            self.assertEqual(
                actual, list(iter_written_sentences(archive_path, manifest))
            )

    def test_zip_reader_rejects_changed_document_inventory(self):
        with tempfile.TemporaryDirectory(
            dir=Path(__file__).parents[1] / ".cache"
        ) as temp:
            archive_path = Path(temp) / "fixture.zip"
            with ZipFile(archive_path, "w") as archive:
                archive.writestr("OANC-GrAF/data/written_1/a.txt", "One document.")
            with self.assertRaisesRegex(ValueError, "inventory changed"):
                list(
                    iter_written_sentences(
                        archive_path,
                        {"selectedCollections": ["written_1"], "selectedDocuments": 2},
                    )
                )

    def test_archive_download_is_chunked_hash_verified_and_atomic(self):
        content = b"pinned OANC bytes" * 100
        digest = hashlib.sha256(content).hexdigest()
        with tempfile.TemporaryDirectory(
            dir=Path(__file__).parents[1] / ".cache"
        ) as temp:
            destination = Path(temp) / "archive.zip"
            opener = Mock(return_value=ChunkedResponse(content))
            result = download_verified(
                "https://example.test/archive.zip",
                digest,
                len(content),
                destination,
                opener=opener,
                wait=Mock(),
            )
            self.assertEqual(result, {"bytes": len(content), "sha256": digest})
            self.assertEqual(destination.read_bytes(), content)
            self.assertFalse(destination.with_name("archive.zip.download").exists())

    def test_bad_archive_download_preserves_existing_file(self):
        content = b"wrong bytes"
        with tempfile.TemporaryDirectory(
            dir=Path(__file__).parents[1] / ".cache"
        ) as temp:
            destination = Path(temp) / "archive.zip"
            destination.write_bytes(b"existing file")
            with self.assertRaisesRegex(ValueError, "archive hash mismatch"):
                download_verified(
                    "https://example.test/archive.zip",
                    "0" * 64,
                    len(content),
                    destination,
                    opener=Mock(return_value=ChunkedResponse(content)),
                    wait=Mock(),
                )
            self.assertEqual(destination.read_bytes(), b"existing file")
            self.assertFalse(destination.with_name("archive.zip.download").exists())

    def test_wilson_intervals_handle_boundaries_and_reject_invalid_counts(self):
        self.assertIsNone(wilson_interval(0, 0))
        self.assertEqual(wilson_interval(0, 20)[0], 0)
        self.assertEqual(wilson_interval(20, 20)[1], 1)
        self.assertLess(wilson_interval(10, 20)[0], 0.5)
        self.assertGreater(wilson_interval(10, 20)[1], 0.5)
        with self.assertRaises(ValueError):
            wilson_interval(21, 20)


if __name__ == "__main__":
    unittest.main()
