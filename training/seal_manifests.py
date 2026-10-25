"""Complete and validate release metadata without changing trained weights or inventing metrics."""

import hashlib
import importlib.metadata
import json
import argparse

from train_release import ROOT, SEED, write_json


def main():
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--syntax-only", action="store_true")
    group.add_argument("--classifier-only", action="store_true")
    args = parser.parse_args()
    out = ROOT / "models/generated/ewt-1"
    provenance = json.loads(
        (ROOT / "training/datasets/ewt-manifest.json").read_text(encoding="utf-8")
    )
    for name, record in provenance["files"].items():
        if (
            hashlib.sha256(
                (ROOT / "training/datasets/raw/ewt" / name).read_bytes()
            ).hexdigest()
            != record["sha256"]
        ):
            raise ValueError(f"Source hash changed: {name}")
    provenance["sha256"] = hashlib.sha256(
        json.dumps(provenance["files"], sort_keys=True).encode()
    ).hexdigest()
    dependencies = {
        name: importlib.metadata.version(name)
        for name in ["torch", "numpy", "onnx", "onnxruntime", "scikit-learn"]
    }
    configurations = {
        "tagger": {
            "epochs": 12,
            "wordDimensions": 64,
            "characterDimensions": 16,
            "characterCNNChannels": 32,
            "bidirectionalLSTMHidden": 64,
            "tagCount": 17,
            "maximumTokens": 128,
        },
        "parser": {
            "epochs": 6,
            "beamWidth": 4,
            "featurePositions": 10,
            "transitionSystem": "arc-standard",
            "maximumTokens": 128,
        },
        "classifier": {
            "epochs": 10,
            "wordDimensions": 24,
            "tagDimensions": 6,
            "hidden": 64,
            "contextPositions": 7,
            "numericFeatures": 6,
        },
    }
    selected = (
        ["tagger", "parser"]
        if args.syntax_only
        else ["classifier"]
        if args.classifier_only
        else list(configurations)
    )
    for name in selected:
        defaults = configurations[name]
        path = out / f"{name}-manifest.json"
        manifest = json.loads(path.read_text(encoding="utf-8"))
        artifact = out / manifest["artifact"]
        if hashlib.sha256(artifact.read_bytes()).hexdigest() != manifest["sha256"]:
            raise ValueError(f"Weight hash changed: {name}")
        manifest.update(language="en-US", provenance=[provenance])
        training = manifest.setdefault("training", {})
        configuration = training.get("configuration", defaults).copy()
        # Prefer the configuration recorded by the trainer, including for parsers
        # whose older manifests inherited the tagger's top-level epoch count.
        if name == "tagger" or name == "parser" and "configuration" not in training:
            configuration["epochs"] = training["epochs"]
        if "epochs" in configuration:
            training["epochs"] = configuration["epochs"]
        configurations[name] = configuration
        training.update(
            seed=training.get("seed", SEED),
            dependencies=training.get("dependencies", dependencies),
            configuration=configurations[name],
            quantization="float32; separate int8 candidates evaluated without automatic promotion",
            dependencyLockSha256=hashlib.sha256(
                (ROOT / "training/requirements.lock.txt").read_bytes()
            ).hexdigest(),
        )
        if name == "classifier":
            manifest["inputSchema"] = {
                "words": "int64[N,7]",
                "tags": "int64[N,7]",
                "features": "float32[N,6]",
            }
            manifest["outputSchema"] = {"scores": "float32[N,5]"}
        write_json(path, manifest)
    print(json.dumps({"sealed": selected, "provenanceSha256": provenance["sha256"]}))


if __name__ == "__main__":
    main()
