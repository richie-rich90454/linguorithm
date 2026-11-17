"""Validate benchmark v2 duplicate, writer-proxy, probe, and determinism controls."""

import json
import tempfile
import unittest
from pathlib import Path

from training.benchmark_v2 import (
    SPLITS,
    assign_splits,
    build,
    near_duplicate_components,
    tokenize,
    writer_proxy_clusters,
)

DUPLICATE = "the quick brown fox jumps over the lazy dog near the river bank"
STYLE_LEFT = "he is in the room and she is on the table"
STYLE_RIGHT = "he is in the yard and she is on the floor"
MARKER = "xylophone"

UNIQUE_TEXTS = {
    "alpha": "photosynthesis converts sunlight into chemical energy inside green leaves",
    "beta": "tectonic plates drift slowly across the mantle and reshape continents",
    "gamma": f"the {MARKER} player rehearsed a difficult symphony before the concert",
    "delta": "quantum computers encode information in superpositions of possible states",
    "epsilon": "migratory birds navigate using magnetic fields and the setting sun",
    "zeta": "fermentation turns grape juice into wine through the action of yeast",
}


def document(document_id, split, text):
    return {
        "id": document_id,
        "split": split,
        "text": text,
        "annotations": [{"type": "Word_choice", "spans": [[0, 3]]}],
    }


def write_benchmark(directory, documents):
    path = Path(directory) / "benchmark.json"
    path.write_text(
        json.dumps(
            {
                "format": "linguorithm-realec-local-benchmark-v1",
                "source": "synthetic",
                "license": "CC-BY-SA-4.0",
                "archiveSha256": "0" * 64,
                "documents": documents,
            }
        ),
        encoding="utf-8",
    )
    return path


class TokenizerTests(unittest.TestCase):
    def test_words_keep_internal_apostrophes_and_punctuation_is_separate(self):
        tokens = tokenize("Don't stop—it\u2019s fine, isn't it?")
        self.assertEqual(
            [text for text, _, _ in tokens],
            ["Don't", "stop", "\u2014", "it\u2019s", "fine", ",", "isn't", "it", "?"],
        )

    def test_leading_apostrophe_is_its_own_token(self):
        tokens = tokenize("rock 'n' roll")
        self.assertEqual(
            [text for text, _, _ in tokens], ["rock", "'", "n", "'", "roll"]
        )

    def test_offsets_skip_whitespace(self):
        self.assertEqual(tokenize("ab  cd"), [("ab", 0, 2), ("cd", 4, 6)])


class DuplicateTests(unittest.TestCase):
    def test_cross_split_near_duplicate_is_detected_and_dropped(self):
        documents = [
            document("dup-test", "test", DUPLICATE),
            document("dup-train", "train", DUPLICATE),
            document("alpha", "train", UNIQUE_TEXTS["alpha"]),
            document("beta", "development", UNIQUE_TEXTS["beta"]),
            document("gamma", "test", UNIQUE_TEXTS["gamma"]),
            document("delta", "train", UNIQUE_TEXTS["delta"]),
        ]
        with tempfile.TemporaryDirectory() as directory:
            manifest_path = Path(directory) / "v2/manifest.json"
            report = build(
                write_benchmark(directory, documents),
                manifest_path,
                Path(directory) / "reports/report.json",
                generated_at="2026-01-01T00:00:00Z",
            )
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

        self.assertEqual(manifest["droppedDocuments"], ["dup-test", "dup-train"])
        self.assertEqual(len(manifest["duplicateComponents"]), 1)
        self.assertTrue(manifest["duplicateComponents"][0]["crossSplit"])
        self.assertEqual(report["nearDuplicates"]["components"], 1)
        self.assertEqual(report["nearDuplicates"]["crossSplitComponents"], 1)
        self.assertEqual(report["nearDuplicates"]["droppedDocuments"], 2)

        kept = [
            entry["id"] for split in SPLITS for entry in manifest["documents"][split]
        ]
        self.assertEqual(sorted(kept), ["alpha", "beta", "delta", "gamma"])
        self.assertEqual(
            report["v2"]["train"]["documents"]
            + report["v2"]["development"]["documents"]
            + report["v2"]["test"]["documents"],
            4,
        )

    def test_disjoint_documents_are_kept(self):
        documents = [
            document(name, "train", text) for name, text in UNIQUE_TEXTS.items()
        ]
        tokenized = {item["id"]: tokenize(item["text"]) for item in documents}
        self.assertEqual(near_duplicate_components(documents, tokenized), [])


class WriterProxyTests(unittest.TestCase):
    def test_matching_style_documents_cluster_and_are_never_split(self):
        documents = [
            document("style-a", "train", STYLE_LEFT),
            document("style-b", "test", STYLE_RIGHT),
        ] + [document(name, "train", text) for name, text in UNIQUE_TEXTS.items()]
        tokenized = {item["id"]: tokenize(item["text"]) for item in documents}
        clusters = writer_proxy_clusters(documents, tokenized)
        joined = [cluster for cluster in clusters if "style-a" in cluster]
        self.assertEqual(len(joined), 1)
        self.assertIn("style-b", joined[0])

        with tempfile.TemporaryDirectory() as directory:
            manifest_path = Path(directory) / "v2/manifest.json"
            build(
                write_benchmark(directory, documents),
                manifest_path,
                Path(directory) / "reports/report.json",
                generated_at="2026-01-01T00:00:00Z",
            )
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

        split_of = {
            entry["id"]: split
            for split in SPLITS
            for entry in manifest["documents"][split]
        }
        self.assertEqual(split_of["style-a"], split_of["style-b"])
        for cluster in manifest["writerClusters"]:
            self.assertEqual(len({split_of[document_id] for document_id in cluster}), 1)

    def test_split_assignment_keeps_every_cluster_whole(self):
        clusters = [
            ["a", "b", "c"],
            ["d"],
            ["e", "f"],
            ["g"],
            ["h"],
            ["i"],
            ["j", "k"],
            ["l"],
            ["m"],
            ["n"],
        ]
        assignment = assign_splits(clusters, seed=7)
        self.assertEqual(
            sorted(assignment), sorted(item for cluster in clusters for item in cluster)
        )
        for cluster in clusters:
            self.assertEqual(len({assignment[item] for item in cluster}), 1)
        self.assertTrue(set(assignment.values()) <= set(SPLITS))


class ManifestTests(unittest.TestCase):
    def _documents(self):
        return [
            document("dup-test", "test", DUPLICATE),
            document("dup-train", "train", DUPLICATE),
            document("style-a", "train", STYLE_LEFT),
            document("style-b", "test", STYLE_RIGHT),
        ] + [document(name, "train", text) for name, text in UNIQUE_TEXTS.items()]

    def test_outputs_contain_no_raw_text(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest_path = Path(directory) / "v2/manifest.json"
            report_path = Path(directory) / "reports/report.json"
            build(
                write_benchmark(directory, self._documents()),
                manifest_path,
                report_path,
                generated_at="2026-01-01T00:00:00Z",
            )
            manifest_text = manifest_path.read_text(encoding="utf-8")
            report_text = report_path.read_text(encoding="utf-8")

        for raw in (manifest_text, report_text):
            self.assertNotIn(MARKER, raw)
            self.assertNotIn("quick brown fox", raw)
        manifest = json.loads(manifest_text)
        self.assertEqual(manifest["recallProbe"]["split"], "development")
        self.assertNotIn("text", json.dumps(manifest["documents"]))

    def test_output_is_deterministic(self):
        outputs = []
        for _ in range(2):
            with tempfile.TemporaryDirectory() as directory:
                manifest_path = Path(directory) / "v2/manifest.json"
                report_path = Path(directory) / "reports/report.json"
                build(
                    write_benchmark(directory, self._documents()),
                    manifest_path,
                    report_path,
                    generated_at="2026-01-01T00:00:00Z",
                )
                outputs.append((manifest_path.read_bytes(), report_path.read_bytes()))
        self.assertEqual(outputs[0], outputs[1])


if __name__ == "__main__":
    unittest.main()
