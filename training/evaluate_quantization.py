"""Compare real float/int8 models on held-out syntax data; never silently promote."""

import copy
import json
import time

import numpy as np
import onnxruntime as ort
from train_release import ROOT, TAGS, decode, encode, parse, read_corpus, write_json


def main():
    out = ROOT / "models/generated/ewt-1"
    metadata = json.loads((out / "tagger-manifest.json").read_text(encoding="utf-8"))
    parser_metadata = json.loads(
        (out / "parser-manifest.json").read_text(encoding="utf-8")
    )
    seen = set()
    test = []
    for split in ["train", "dev", "test"]:
        rows = read_corpus(ROOT / f"training/datasets/raw/ewt/en_ewt-ud-{split}.conllu")
        selected = [r for r in rows if tuple(r["tokens"]) not in seen]
        seen.update(tuple(r["tokens"]) for r in selected)
        if split == "test":
            test = selected
    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    results = {}
    for variant in ["float", "int8"]:
        suffix = ".int8" if variant == "int8" else ""
        try:
            tagger = ort.InferenceSession(
                str(out / f"tagger{suffix}.onnx"),
                options,
                providers=["CPUExecutionProvider"],
            )
            parser = ort.InferenceSession(
                str(out / f"parser{suffix}.onnx"),
                options,
                providers=["CPUExecutionProvider"],
            )
            correct, total, uas, las = 0, 0, 0, 0
            started = time.perf_counter()
            for original in test:
                row = copy.deepcopy(original)
                words, chars, lengths, _ = encode(
                    [row], metadata["vocabulary"], metadata["characters"]
                )
                emissions = tagger.run(
                    None,
                    {
                        "words": words.numpy(),
                        "chars": chars.numpy(),
                        "lengths": lengths.numpy(),
                    },
                )[0][0]
                predicted = decode(
                    emissions,
                    np.array(metadata["transitions"]),
                    np.array(metadata["startScores"]),
                    np.array(metadata["endScores"]),
                )
                row["predictedTags"] = [TAGS[i] for i in predicted]
                correct += sum(
                    a == b
                    for a, b in zip(row["tags"], row["predictedTags"], strict=True)
                )
                row["predicted"] = row["predictedTags"]
                state = parse(
                    parser, row, metadata["vocabulary"], parser_metadata["actions"]
                )
                heads, relations = state[2], state[3]
                uas += sum(a == b for a, b in zip(heads, row["heads"], strict=True))
                las += sum(
                    a == b and c == d
                    for a, b, c, d in zip(
                        heads, row["heads"], relations, row["relations"], strict=True
                    )
                )
                total += len(row["tokens"])
            results[variant] = {
                "sentences": len(test),
                "tokens": total,
                "posAccuracy": correct / total,
                "uas": uas / total,
                "las": las / total,
                "elapsedSeconds": time.perf_counter() - started,
            }
        except Exception as error:  # noqa: BLE001 - record any unsupported runtime/model operator as an explicit failed comparison
            results[variant] = {"error": str(error)}
        print(json.dumps({variant: results[variant]}), flush=True)
    write_json(
        ROOT / "reports/quantization-evaluation.json",
        {
            "results": results,
            "production": "float32",
            "policy": "Int8 requires full quality and browser compatibility review before promotion",
        },
    )


if __name__ == "__main__":
    main()
