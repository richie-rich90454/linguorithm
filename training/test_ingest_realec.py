"""Validate REALEC cache ingestion and UTF-16 annotation coordinates offline."""

import io
import tarfile
import tempfile
import unittest
from pathlib import Path

from ingest_realec import parse_annotations, read_archive, read_manifest, split_for_document


class RealecIngestionTests(unittest.TestCase):
    def test_manifest_pins_the_licensed_source_and_evaluation_only_purpose(self):
        manifest = read_manifest()
        self.assertEqual(manifest["license"], "CC-BY-SA-4.0")
        self.assertIn("evaluation only", manifest["purpose"])
        self.assertEqual(len(manifest["archiveSha256"]), 64)

    def test_annotations_convert_codepoint_offsets_to_javascript_utf16(self):
        text = "😀 They is ready."
        annotations = parse_annotations(
            text,
            "T1\tAgreement_errors 7 9\tis\n"
            "T2\tpos_VBZ 7 9\n"
            "#1\tAnnotatorNotes T1\tare\n",
            "unicode-case",
        )
        self.assertEqual(
            annotations,
            [
                {
                    "type": "Agreement_errors",
                    "spans": [(8, 10)],
                    "surfaceVerified": True,
                    "offsetAdjusted": False,
                }
            ],
        )
        self.assertEqual(text.encode("utf-16-le")[16:20].decode("utf-16-le"), "is")

    def test_annotations_accept_existing_utf16_offsets_after_astral_characters(self):
        text = "😀 They is ready."
        annotations = parse_annotations(
            text, "T1\tAgreement_errors 8 10\tis", "utf16-case"
        )
        self.assertEqual(annotations[0]["spans"], [(8, 10)])

    def test_mismatched_annotation_surfaces_fail_closed(self):
        with self.assertRaisesRegex(ValueError, "does not match"):
            parse_annotations("They are ready.", "T1\tAgreement_errors 5 8\tis", "bad-case")

    def test_range_only_annotations_are_retained_after_bounds_validation(self):
        annotations = parse_annotations(
            "They are ready.", "T1\tSpelling 5 8", "range-only"
        )
        self.assertEqual(
            annotations,
            [
                {
                    "type": "Spelling",
                    "spans": [(5, 8)],
                    "surfaceVerified": False,
                    "offsetAdjusted": False,
                }
            ],
        )

    def test_unique_nearby_annotation_surface_repairs_small_source_offset_drift(self):
        annotations = parse_annotations(
            "We also gave our answer.",
            "T1\tTense_choice 4 13\talso gave",
            "offset-drift",
        )
        self.assertEqual(annotations[0]["spans"], [(3, 12)])
        self.assertTrue(annotations[0]["offsetAdjusted"])

    def test_document_split_is_stable_and_covers_all_partitions(self):
        expected = split_for_document("esl_00123")
        self.assertEqual(split_for_document("esl_00123"), expected)
        self.assertTrue(
            any(
                split_for_document(f"esl_{index:05d}")
                != split_for_document(f"esl_{index:05d}", "other-seed")
                for index in range(100)
            )
        )
        self.assertEqual(
            {split_for_document(f"esl_{index:05d}") for index in range(100)},
            {"train", "development", "test"},
        )

    def test_archive_reader_keeps_only_top_level_english_text_and_annotation_pairs(self):
        with tempfile.TemporaryDirectory() as directory:
            archive_path = Path(directory) / "sample.tar.gz"
            with tarfile.open(archive_path, "w:gz") as archive:
                for index in range(100):
                    document_id = f"esl_{index:05d}"
                    text = "The students is ready."
                    annotation = "T1\tAgreement_errors 13 15\tis"
                    for extension, content in (("txt", text), ("ann", annotation)):
                        data = content.encode("utf-8")
                        info = tarfile.TarInfo(f"{document_id}.{extension}")
                        info.size = len(data)
                        archive.addfile(info, io.BytesIO(data))
                data = b"must not be loaded"
                info = tarfile.TarInfo("de/foreign.txt")
                info.size = len(data)
                archive.addfile(info, io.BytesIO(data))
                info = tarfile.TarInfo("../esl_99999.txt")
                info.size = len(data)
                archive.addfile(info, io.BytesIO(data))

            documents = read_archive(archive_path)
            self.assertEqual(len(documents), 100)
            self.assertTrue(all("foreign" not in item["text"] for item in documents))
            self.assertTrue(all(len(item["annotations"]) == 1 for item in documents))
            self.assertEqual(
                {item["split"] for item in documents}, {"train", "development", "test"}
            )

    def test_archive_rejects_missing_annotation_pairs(self):
        with tempfile.TemporaryDirectory() as directory:
            archive_path = Path(directory) / "sample.tar.gz"
            with tarfile.open(archive_path, "w:gz") as archive:
                for index in range(100):
                    document_id = f"esl_{index:05d}"
                    data = b"A text."
                    info = tarfile.TarInfo(f"{document_id}.txt")
                    info.size = len(data)
                    archive.addfile(info, io.BytesIO(data))
                data = b"T1\tAgreement_errors 2 6\ttext"
                info = tarfile.TarInfo("esl_00000.ann")
                info.size = len(data)
                archive.addfile(info, io.BytesIO(data))
            with self.assertRaisesRegex(ValueError, "Missing REALEC annotations"):
                read_archive(archive_path)


if __name__ == "__main__":
    unittest.main()
