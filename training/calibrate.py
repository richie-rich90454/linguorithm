"""Fit a Platt calibrator to independently held-out raw scores, never training rows."""

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "scores",
        type=Path,
        help="JSONL: score, label (0/1), split (calibration/test), group",
    )
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    if args.output.exists():
        raise ValueError("Refusing to overwrite an existing calibration artifact.")
    rows = [
        json.loads(line)
        for line in args.scores.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    calibration = [r for r in rows if r["split"] == "calibration"]
    test = [r for r in rows if r["split"] == "test"]
    if not calibration or not test or {r["label"] for r in calibration} != {0, 1}:
        raise ValueError(
            "Need both labels in calibration and a nonempty held-out test set."
        )
    if {r["group"] for r in calibration} & {r["group"] for r in test}:
        raise ValueError("Calibration and test groups must be disjoint.")
    features = np.array([[float(r["score"])] for r in calibration])
    test_features = np.array([[float(r["score"])] for r in test])
    if not np.isfinite(features).all() or not np.isfinite(test_features).all():
        raise ValueError("Scores must be finite.")
    model = LogisticRegression(random_state=1729).fit(
        features, [r["label"] for r in calibration]
    )
    predicted = model.predict_proba(test_features)[:, 1]
    labels = [r["label"] for r in test]
    result = {
        "method": "Platt",
        "a": float(model.coef_[0, 0]),
        "b": float(model.intercept_[0]),
        "provenance": str(args.scores),
        "sha256": hashlib.sha256(args.scores.read_bytes()).hexdigest(),
        "evaluation": {
            "testCount": len(test),
            "brier": brier_score_loss(labels, predicted),
            "logLoss": log_loss(labels, predicted, labels=[0, 1]),
        },
        "status": "Candidate; choose category thresholds on independent validation data before promotion",
    }
    args.output.write_text(json.dumps(result, indent=4) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
