"""Oracle-feature classical reference; not a head-to-head neural comparison."""

import json

import numpy as np
from ewt_splits import verified_splits
from sklearn.feature_extraction import DictVectorizer
from sklearn.linear_model import SGDClassifier
from sklearn.metrics import precision_recall_fscore_support
from train_errors import LABELS, examples
from train_release import ROOT, SEED, read_corpus, write_json


def main():
    out = ROOT / "models/generated/ewt-1"
    metadata = json.loads((out / "tagger-manifest.json").read_text(encoding="utf-8"))
    lexicon = json.loads((out / "lexicon.json").read_text(encoding="utf-8"))
    splits, provenance = verified_splits(ROOT, read_corpus)
    data = {
        split: examples(rows, metadata["vocabulary"], lexicon["frequency"])
        for split, rows in splits.items()
    }

    def features(row):
        words, tags, numeric, _ = row
        result = {f"word_{i}={value}": 1 for i, value in enumerate(words)}
        result.update({f"tag_{i}={value}": 1 for i, value in enumerate(tags)})
        result.update({f"morph_{i}": value for i, value in enumerate(numeric)})
        return result

    vectorizer = DictVectorizer(dtype=np.float32)
    matrices = {
        "train": vectorizer.fit_transform([features(row) for row in data["train"]])
    }
    matrices.update(
        {
            split: vectorizer.transform([features(row) for row in data[split]])
            for split in ["dev", "test"]
        }
    )
    labels = {split: np.array([row[3] for row in data[split]]) for split in data}
    for matrix in matrices.values():
        matrix.indices = matrix.indices.astype(np.int32)
        matrix.indptr = matrix.indptr.astype(np.int32)
    best = None
    for alpha in [0.00001, 0.0001, 0.001]:
        model = SGDClassifier(
            loss="log_loss",
            alpha=alpha,
            random_state=SEED,
            max_iter=1000,
            tol=0.0001,
            class_weight="balanced",
        ).fit(matrices["train"], labels["train"])
        score = float((model.predict(matrices["dev"]) == labels["dev"]).mean())
        if best is None or score > best[0]:
            best = (score, model, alpha)
    prediction = best[1].predict(matrices["test"])
    precision, recall, f1, support = precision_recall_fscore_support(
        labels["test"], prediction, labels=list(range(len(LABELS))), zero_division=0
    )
    metrics = {
        name: {
            "precision": float(precision[i]),
            "recall": float(recall[i]),
            "f1": float(f1[i]),
            "support": int(support[i]),
        }
        for i, name in enumerate(LABELS)
    }
    result = {
        "task": "Controlled synthetic EWT errors; not learner-essay evaluation",
        "model": "Oracle-feature sparse logistic SGD reference",
        "featureSource": "Gold UD POS, dependency heads and subject morphology; unavailable to the production neural classifier",
        "cohort": "Gold-selected mutation targets and paired clean controls; no predicted-syntax eligibility exclusions or additional cross-POS clean controls",
        "comparableHeadToHead": False,
        **provenance,
        "splitPolicy": "Official splits; exact token sequences and document groups excluded against earlier splits; train-only fit, dev-only alpha selection, untouched test evaluation",
        "seed": SEED,
        "alphaSelectedOnValidation": best[2],
        "validationAccuracy": best[0],
        "test": metrics,
        "neuralContextOnly": {
            "evaluation": json.loads(
                (out / "classifier-manifest.json").read_text(encoding="utf-8")
            )["evaluation"],
            "featureSource": "Frozen predicted syntax and learned lexical morphology",
            "cohort": "Tokenization-stable predicted-syntax cohort with additional cross-POS clean controls",
            "operatingPoint": "Validation-calibrated per-category precision thresholds and runtime POS guards",
        },
        "policy": "This oracle-feature reference and deployed neural classifier have different features, cohorts and operating points (argmax versus calibrated thresholds). Their metrics are not a comparable head-to-head result and establish neither neural superiority nor natural-essay accuracy.",
    }
    write_json(ROOT / "reports/candidate-classifier-baseline.json", result)
    print(json.dumps(metrics), flush=True)


if __name__ == "__main__":
    main()
