"""Score the development-selected parser beam once on the fixed EWT test split."""

import hashlib
import json
from pathlib import Path

import numpy as np
import onnxruntime as ort

import train_release as tr
from ewt_splits import verified_splits
from training_stats import wilson_interval


ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / "apps/web/public/models"
DEVELOPMENT_REPORT = ROOT / ".cache/parser-beam-development.json"
OUTPUT = ROOT / "reports/parser-beam-candidate-evaluation.json"


def artifact_hashes():
    return {
        "tagger": {
            "manifestSha256": hashlib.sha256(
                (MODELS / "tagger-manifest.json").read_bytes()
            ).hexdigest(),
            "weightsSha256": hashlib.sha256(
                (MODELS / "weights/tagger.onnx").read_bytes()
            ).hexdigest(),
        },
        "parser": {
            "manifestSha256": hashlib.sha256(
                (MODELS / "parser-manifest.json").read_bytes()
            ).hexdigest(),
            "weightsSha256": hashlib.sha256(
                (MODELS / "weights/parser.onnx").read_bytes()
            ).hexdigest(),
        },
    }


def verify_model_registry():
    registry = json.loads((MODELS / "registry.json").read_text(encoding="utf-8"))
    for task in ("tagger", "parser"):
        resource = registry[task]
        manifest_path = MODELS / resource["path"]
        manifest_bytes = manifest_path.read_bytes()
        if hashlib.sha256(manifest_bytes).hexdigest() != resource["sha256"]:
            raise ValueError(f"The {task} manifest is not the registered resource.")
        manifest = json.loads(manifest_bytes)
        weights_path = MODELS / "weights" / manifest["artifact"]
        if hashlib.sha256(weights_path.read_bytes()).hexdigest() != manifest["sha256"]:
            raise ValueError(f"The {task} weights do not match their manifest.")


def load_development_selection():
    verify_model_registry()
    report = json.loads(DEVELOPMENT_REPORT.read_text(encoding="utf-8"))
    _, provenance = verified_splits(ROOT, tr.read_corpus)
    if report.get("provenance") != provenance:
        raise ValueError("Development selection does not match the pinned EWT splits.")
    if report.get("modelArtifacts") != artifact_hashes():
        raise ValueError("Development selection does not match the current model artifacts.")
    width = report.get("selectedWidth")
    if width not in {1, 2, 4, 8, 16}:
        raise ValueError("Development selection contains an unsupported beam width.")
    return width, report


def main():
    width, development = load_development_selection()
    tagger_metadata = json.loads((MODELS / "tagger-manifest.json").read_text())
    parser_metadata = json.loads((MODELS / "parser-manifest.json").read_text())
    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    tagger = ort.InferenceSession(
        str(MODELS / "weights/tagger.onnx"), options, providers=["CPUExecutionProvider"]
    )
    parser = ort.InferenceSession(
        str(MODELS / "weights/parser.onnx"), options, providers=["CPUExecutionProvider"]
    )
    splits, provenance = verified_splits(ROOT, tr.read_corpus)
    rows = splits["test"]
    correct_pos = correct_uas = correct_las = total = 0
    for offset in range(0, len(rows), 64):
        batch = rows[offset : offset + 64]
        words, chars, lengths, _ = tr.encode(
            batch, tagger_metadata["vocabulary"], tagger_metadata["characters"]
        )
        emissions = tagger.run(
            None,
            {
                "words": words.numpy(),
                "chars": chars.numpy(),
                "lengths": lengths.numpy(),
            },
        )[0]
        for index, row in enumerate(batch):
            predicted = tr.decode(
                emissions[index, : len(row["tokens"])],
                np.asarray(tagger_metadata["transitions"]),
                np.asarray(tagger_metadata["startScores"]),
                np.asarray(tagger_metadata["endScores"]),
            )
            row["predictedTags"] = [tr.TAGS[tag] for tag in predicted]
            correct_pos += sum(
                tag == tr.TAGS.index(gold)
                for tag, gold in zip(predicted, row["tags"], strict=True)
            )
        for index, row in enumerate(batch, start=offset + 1):
            state = tr.parse(
                parser,
                row,
                parser_metadata["vocabulary"],
                parser_metadata["actions"],
                beam_width=width,
            )
            for head, relation, gold_head, gold_relation in zip(
                state[2], state[3], row["heads"], row["relations"], strict=True
            ):
                correct_uas += head == gold_head
                correct_las += head == gold_head and relation == gold_relation
                total += 1
            if index % 250 == 0 or index == len(rows):
                print(
                    json.dumps(
                        {
                            "event": "heldout-parser-progress",
                            "beamWidth": width,
                            "sentences": index,
                            "totalSentences": len(rows),
                        }
                    ),
                    flush=True,
                )

    counts = {"pos": correct_pos, "uas": correct_uas, "las": correct_las}
    baseline = {
        "pos": tagger_metadata["evaluation"]["tagger"]["tokenAccuracy"],
        "uas": parser_metadata["evaluation"]["uas"],
        "las": parser_metadata["evaluation"]["las"],
    }
    metrics = {
        name: {
            "accuracy": count / total,
            "correct": count,
            "tokens": total,
            "wilson95TokenLevel": wilson_interval(count, total),
            "baseline": baseline[name],
            "deltaPercentagePoints": 100 * (count / total - baseline[name]),
        }
        for name, count in counts.items()
    }
    report = {
        "scope": "One fixed EWT test evaluation at the beam width selected on EWT development; test scores did not select the width.",
        "split": "official EWT test, document-disjoint and exact-deduplicated",
        "provenance": provenance,
        "modelArtifacts": artifact_hashes(),
        "developmentSelection": {
            "selectedWidth": width,
            "selectionMetric": development["selectionMetric"],
            "developmentReport": ".cache/parser-beam-development.json",
            "results": development["results"],
        },
        "beamWidth": width,
        "sentences": len(rows),
        "tokens": total,
        "confidenceIntervalNote": "Wilson intervals are token-level descriptive intervals and do not adjust for within-document clustering.",
        "metrics": metrics,
        "regressionGate": "POS, UAS, and LAS must each be no lower than the frozen manifest baseline before changing production decoding.",
        "passedNoRegression": all(value["deltaPercentagePoints"] >= 0 for value in metrics.values()),
    }
    OUTPUT.write_text(json.dumps(report, indent=4) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    if not report["passedNoRegression"]:
        raise SystemExit("Selected beam candidate failed the fixed no-regression gate.")


if __name__ == "__main__":
    main()
