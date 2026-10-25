"""Supplemental UD corpus ingestion never crosses split or license boundaries."""

import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

from train_release import read_corpus
from ud_english_sources import (
    DATA_ROOT,
    MANIFEST_NAME,
    ingest,
    load_evaluation_rows,
    load_training_rows,
    read_manifest,
)


class UdEnglishSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        (Path(__file__).parents[1] / ".cache").mkdir(exist_ok=True)

    def fixture(self, root):
        sentence = (
            b"# sent_id = fixture-1\n"
            b"# text = Dogs run.\n"
            b"1\tDogs\tdog\tNOUN\tNNS\tNumber=Plur\t2\tnsubj\t_\t_\n"
            b"2\trun\trun\tVERB\tVBP\tNumber=Plur|Person=3|Tense=Pres|VerbForm=Fin"
            b"\t0\troot\t_\t_\n"
            b"3\t.\t.\tPUNCT\t.\t_\t2\tpunct\t_\t_\n\n"
        )
        records = []
        sources = [
            {
                "id": "ud-en-atis-r2.18",
                "use": "syntax-training-and-held-out-evaluation",
                "splits": {
                    "train": "en_atis-ud-train.conllu",
                    "test": "en_atis-ud-test.conllu",
                },
            },
            {
                "id": "ud-en-pronouns-r2.18",
                "use": "held-out-evaluation-only",
                "splits": {"test": "en_pronouns-ud-test.conllu"},
            },
        ]
        for source in sources:
            file_records = {}
            base = root / DATA_ROOT / source["id"]
            base.mkdir(parents=True)
            for name in ["README.md", "LICENSE.txt", *source["splits"].values()]:
                content = sentence if name.endswith(".conllu") else name.encode()
                (base / name).write_bytes(content)
                file_records[name] = {"sha256": hashlib.sha256(content).hexdigest()}
            records.append(
                {
                    **source,
                    "repository": "https://github.com/UniversalDependencies/UD_English-Atis",
                    "commit": "a" * 40,
                    "license": "CC-BY-SA-4.0",
                    "domain": "test fixture",
                    "files": file_records,
                }
            )
        manifest_path = root / MANIFEST_NAME
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_text(
            json.dumps({"schemaVersion": 1, "sources": records}), encoding="utf-8"
        )
        return sentence

    def test_checked_in_manifest_has_separate_training_and_heldout_sources(self):
        root = Path(__file__).parents[1]
        manifest = read_manifest(root)
        training = [
            source for source in manifest["sources"] if "train" in source["splits"]
        ]
        evaluation_only = [
            source
            for source in manifest["sources"]
            if source["use"] == "held-out-evaluation-only"
        ]
        self.assertEqual(len(manifest["sources"]), 7)
        self.assertEqual(len(training), 3)
        self.assertEqual(len(evaluation_only), 4)
        self.assertTrue(
            all(
                source["license"].startswith("CC-BY-SA-")
                for source in manifest["sources"]
            )
        )

    def test_only_train_splits_enter_training_rows(self):
        with tempfile.TemporaryDirectory(
            dir=Path(__file__).parents[1] / ".cache"
        ) as temp:
            root = Path(temp)
            content = self.fixture(root)
            rows, provenance = load_training_rows(root, read_corpus)
            self.assertEqual([row["sourceId"] for row in rows], ["ud-en-atis-r2.18"])
            self.assertTrue(rows[0]["id"].startswith("ud-en-atis-r2.18:"))
            self.assertTrue(rows[0]["group"].startswith("ud-en-atis-r2.18:"))
            self.assertEqual(rows[0]["tokens"], ["Dogs", "run", "."])
            self.assertEqual(provenance["sources"]["ud-en-atis-r2.18"]["sentences"], 1)
            self.assertEqual(
                len(content),
                len(
                    (
                        root
                        / DATA_ROOT
                        / "ud-en-atis-r2.18"
                        / "en_atis-ud-train.conllu"
                    ).read_bytes()
                ),
            )

    def test_test_splits_remain_separate_from_training(self):
        with tempfile.TemporaryDirectory(
            dir=Path(__file__).parents[1] / ".cache"
        ) as temp:
            root = Path(temp)
            self.fixture(root)
            evaluation = load_evaluation_rows(root, read_corpus)
            self.assertEqual(
                set(evaluation), {"ud-en-atis-r2.18", "ud-en-pronouns-r2.18"}
            )
            self.assertEqual(
                evaluation["ud-en-pronouns-r2.18"]["rows"][0]["tokens"],
                ["Dogs", "run", "."],
            )

    def test_cached_verified_sources_skip_network(self):
        with tempfile.TemporaryDirectory(
            dir=Path(__file__).parents[1] / ".cache"
        ) as temp:
            root = Path(temp)
            self.fixture(root)
            opener = Mock(side_effect=AssertionError("unexpected network request"))
            report = ingest(root, opener=opener)
            self.assertEqual(report["sources"], 2)
            self.assertEqual(report["downloadedFiles"], 0)
            self.assertEqual(report["verifiedExistingFiles"], 7)
            opener.assert_not_called()

    def test_modified_local_source_is_rejected(self):
        with tempfile.TemporaryDirectory(
            dir=Path(__file__).parents[1] / ".cache"
        ) as temp:
            root = Path(temp)
            self.fixture(root)
            target = root / DATA_ROOT / "ud-en-atis-r2.18" / "en_atis-ud-train.conllu"
            target.write_bytes(b"tampered")
            with self.assertRaisesRegex(ValueError, "Modified pinned UD source file"):
                ingest(root, opener=Mock())


if __name__ == "__main__":
    unittest.main()
