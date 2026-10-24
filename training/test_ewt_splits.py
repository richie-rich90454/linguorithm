"""Non-training checks for corpus integrity and leakage exclusions."""

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from ewt_splits import verified_splits


class VerifiedSplitsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        (Path(__file__).parents[1] / ".cache").mkdir(exist_ok=True)

    def fixture(self, root):
        rows = {
            "train": [{"tokens": ["train"], "group": "a"}],
            "dev": [
                {"tokens": ["different"], "group": "a"},
                {"tokens": ["train"], "group": "b"},
                {"tokens": ["dev"], "group": "c"},
            ],
            "test": [
                {"tokens": ["another"], "group": "c"},
                {"tokens": ["dev"], "group": "d"},
                {"tokens": ["test"], "group": "e"},
            ],
        }
        directory = root / "training/datasets/raw/ewt"
        directory.mkdir(parents=True)
        files = {}
        for split, values in rows.items():
            name = f"en_ewt-ud-{split}.conllu"
            data = json.dumps(values).encode()
            (directory / name).write_bytes(data)
            files[name] = {"sha256": hashlib.sha256(data).hexdigest()}
        (root / "training/datasets/ewt-manifest.json").write_text(
            json.dumps({"files": files}), encoding="utf-8"
        )
        return directory

    def test_excludes_prior_split_tokens_and_document_groups(self):
        with tempfile.TemporaryDirectory(
            dir=Path(__file__).parents[1] / ".cache"
        ) as tmp:
            root = Path(tmp)
            self.fixture(root)
            splits, metadata = verified_splits(
                root, lambda path: json.loads(path.read_text(encoding="utf-8"))
            )
            self.assertEqual(
                {
                    name: [row["tokens"] for row in rows]
                    for name, rows in splits.items()
                },
                {"train": [["train"]], "dev": [["dev"]], "test": [["test"]]},
            )
            self.assertEqual(
                metadata["splitExclusions"], {"train": 0, "dev": 2, "test": 2}
            )
            self.assertEqual(len(metadata["corpusHashes"]), 3)

    def test_rejects_modified_test_bytes_before_reading_any_split(self):
        with tempfile.TemporaryDirectory(
            dir=Path(__file__).parents[1] / ".cache"
        ) as tmp:
            root = Path(tmp)
            directory = self.fixture(root)
            with (directory / "en_ewt-ud-test.conllu").open("ab") as stream:
                stream.write(b" ")
            parsed = []
            with self.assertRaisesRegex(ValueError, "hash mismatch: en_ewt-ud-test"):
                verified_splits(root, lambda path: parsed.append(path))
            self.assertEqual(parsed, [])

    def test_real_pinned_corpus_has_disjoint_retained_splits(self):
        from train_release import ROOT, read_corpus

        splits, metadata = verified_splits(ROOT, read_corpus)
        tokens, groups = set(), set()
        for rows in splits.values():
            current_tokens = {tuple(row["tokens"]) for row in rows}
            current_groups = {row["group"] for row in rows}
            self.assertFalse(tokens & current_tokens)
            self.assertFalse(groups & current_groups)
            tokens.update(current_tokens)
            groups.update(current_groups)
        self.assertEqual(
            {name: len(rows) for name, rows in splits.items()},
            {"train": 12542, "dev": 1933, "test": 1962},
        )
        self.assertEqual(len(metadata["corpusHashes"]), 3)


if __name__ == "__main__":
    unittest.main()
