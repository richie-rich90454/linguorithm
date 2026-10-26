"""Select a parser beam width on the pinned EWT development split only."""

import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "training"))

import train_release as tr
from ewt_splits import verified_splits


def main():
    models = ROOT / "apps/web/public/models"
    tagger_metadata = json.loads((models / "tagger-manifest.json").read_text())
    parser_metadata = json.loads((models / "parser-manifest.json").read_text())
    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    tagger = ort.InferenceSession(
        str(models / "weights/tagger.onnx"), options, providers=["CPUExecutionProvider"]
    )
    parser = ort.InferenceSession(
        str(models / "weights/parser.onnx"), options, providers=["CPUExecutionProvider"]
    )
    splits, provenance = verified_splits(ROOT, tr.read_corpus)
    rows = splits["dev"]
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
            row["predictedTags"] = [
                tr.TAGS[tag]
                for tag in tr.decode(
                    emissions[index, : len(row["tokens"])],
                    np.asarray(tagger_metadata["transitions"]),
                    np.asarray(tagger_metadata["startScores"]),
                    np.asarray(tagger_metadata["endScores"]),
                )
            ]

    results = []
    for width in [1, 2, 4, 8, 16]:
        correct_uas = correct_las = total = 0
        print(
            json.dumps(
                {
                    "event": "beam-evaluation-start",
                    "beamWidth": width,
                    "sentences": len(rows),
                }
            ),
            flush=True,
        )
        for index, row in enumerate(rows, start=1):
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
                            "event": "beam-evaluation-progress",
                            "beamWidth": width,
                            "sentences": index,
                            "totalSentences": len(rows),
                        }
                    ),
                    flush=True,
                )
        results.append(
            {
                "beamWidth": width,
                "uas": correct_uas / total,
                "las": correct_las / total,
                "tokens": total,
                "sentences": len(rows),
            }
        )
        print(
            json.dumps(
                {
                    "event": "beam-evaluation-complete",
                    "beamWidth": width,
                    "uas": correct_uas / total,
                    "las": correct_las / total,
                }
            ),
            flush=True,
        )
    selected = max(results, key=lambda item: (item["las"], -item["beamWidth"]))
    report = {
        "scope": "Development-only beam-width selection; no test data was evaluated.",
        "split": "official EWT development, document-disjoint and exact-deduplicated",
        "provenance": provenance,
        "modelArtifacts": {
            "tagger": {
                "manifestSha256": hashlib.sha256(
                    (models / "tagger-manifest.json").read_bytes()
                ).hexdigest(),
                "weightsSha256": hashlib.sha256(
                    (models / "weights/tagger.onnx").read_bytes()
                ).hexdigest(),
            },
            "parser": {
                "manifestSha256": hashlib.sha256(
                    (models / "parser-manifest.json").read_bytes()
                ).hexdigest(),
                "weightsSha256": hashlib.sha256(
                    (models / "weights/parser.onnx").read_bytes()
                ).hexdigest(),
            },
        },
        "baselineWidth": 4,
        "results": results,
        "selectedWidth": selected["beamWidth"],
        "selectionMetric": "highest development LAS; ties prefer the narrowest beam",
    }
    output = ROOT / ".cache/parser-beam-development.json"
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
