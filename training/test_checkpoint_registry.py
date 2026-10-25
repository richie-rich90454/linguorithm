"""Versioned checkpoints are copied from generated artifacts with auditable hashes."""

import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import checkpoint_registry


class CheckpointRegistryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        (Path(__file__).parents[1] / ".cache").mkdir(exist_ok=True)

    def test_records_exact_bytes_and_merges_checkpoint_entries(self):
        with tempfile.TemporaryDirectory(
            dir=Path(__file__).parents[1] / ".cache"
        ) as temp:
            root = Path(temp)
            generated = root / "models/generated/ewt-1"
            generated.mkdir(parents=True)
            checkpoint_registry_dir = root / "models/checkpoints/ewt-1"
            first = generated / "tagger.pt"
            first.write_bytes(b"tagger checkpoint")
            second = generated / "parser.pt"
            second.write_bytes(b"parser checkpoint")
            with (
                patch.object(checkpoint_registry, "ROOT", root),
                patch.object(
                    checkpoint_registry, "CHECKPOINTS", checkpoint_registry_dir
                ),
                patch.object(
                    checkpoint_registry,
                    "MANIFEST",
                    checkpoint_registry_dir / "manifest.json",
                ),
            ):
                checkpoint_registry.record_checkpoint(
                    "tagger.pt", first, {"task": "POS"}
                )
                checkpoint_registry.record_checkpoint(
                    "parser.pt", second, {"task": "parse"}
                )
            manifest = json.loads(
                (checkpoint_registry_dir / "manifest.json").read_text()
            )
            self.assertEqual(set(manifest["checkpoints"]), {"tagger.pt", "parser.pt"})
            for name, content in (
                ("tagger.pt", b"tagger checkpoint"),
                ("parser.pt", b"parser checkpoint"),
            ):
                record = manifest["checkpoints"][name]
                self.assertEqual(record["bytes"], len(content))
                self.assertEqual(record["sha256"], hashlib.sha256(content).hexdigest())
                self.assertEqual((checkpoint_registry_dir / name).read_bytes(), content)

    def test_retains_browser_evidence_only_for_identical_checkpoint_bytes(self):
        with tempfile.TemporaryDirectory(
            dir=Path(__file__).parents[1] / ".cache"
        ) as temp:
            root = Path(temp)
            generated = root / "models/generated/ewt-1"
            generated.mkdir(parents=True)
            checkpoint_registry_dir = root / "models/checkpoints/ewt-1"
            artifact = generated / "error-classifier.pt"
            artifact.write_bytes(b"candidate classifier")
            existing_evaluation = {
                "status": "candidate not promoted",
                "sourceEditIntegrity": {"passed": False, "failures": 1},
            }
            with (
                patch.object(checkpoint_registry, "ROOT", root),
                patch.object(
                    checkpoint_registry, "CHECKPOINTS", checkpoint_registry_dir
                ),
                patch.object(
                    checkpoint_registry,
                    "MANIFEST",
                    checkpoint_registry_dir / "manifest.json",
                ),
            ):
                checkpoint_registry.record_checkpoint(
                    "error-classifier.pt",
                    artifact,
                    {"task": "classifier", "evaluation": existing_evaluation},
                )
                checkpoint_registry.record_checkpoint(
                    "error-classifier.pt",
                    artifact,
                    {"task": "classifier", "evaluation": {}},
                )
                manifest = json.loads(
                    (checkpoint_registry_dir / "manifest.json").read_text()
                )
                self.assertEqual(
                    manifest["checkpoints"]["error-classifier.pt"]["evaluation"],
                    existing_evaluation,
                )

                artifact.write_bytes(b"new candidate classifier")
                checkpoint_registry.record_checkpoint(
                    "error-classifier.pt",
                    artifact,
                    {"task": "classifier", "evaluation": {}},
                )
                manifest = json.loads(
                    (checkpoint_registry_dir / "manifest.json").read_text()
                )
                self.assertEqual(
                    manifest["checkpoints"]["error-classifier.pt"]["evaluation"],
                    {},
                )

    def test_rejects_non_checkpoint_names_and_external_generated_artifacts(self):
        with tempfile.TemporaryDirectory(
            dir=Path(__file__).parents[1] / ".cache"
        ) as temp:
            root = Path(temp)
            generated = root / "models/generated/ewt-1"
            generated.mkdir(parents=True)
            artifact = generated / "tagger.pt"
            artifact.write_bytes(b"checkpoint")
            with (
                patch.object(checkpoint_registry, "ROOT", root),
                patch.object(checkpoint_registry, "CHECKPOINTS", root / "checkpoints"),
                patch.object(
                    checkpoint_registry,
                    "MANIFEST",
                    root / "checkpoints/manifest.json",
                ),
            ):
                with self.assertRaisesRegex(ValueError, "plain .pt filename"):
                    checkpoint_registry.record_checkpoint("../tagger.pt", artifact, {})
                with self.assertRaisesRegex(ValueError, "remain under"):
                    checkpoint_registry.record_checkpoint(
                        "tagger.pt", root / "external.pt", {}
                    )


if __name__ == "__main__":
    unittest.main()
