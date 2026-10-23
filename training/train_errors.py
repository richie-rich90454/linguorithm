"""Train a compact contextual error classifier and calibrators on verified synthetic mutations.

These scores are calibrated for this synthetic task, not for naturally occurring essay errors.
"""

import copy
import hashlib
import json
import random
from collections import Counter

import numpy as np
import onnxruntime as ort
import torch
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, precision_recall_fscore_support
from torch import nn
from train_release import ROOT, SEED, TAGS, read_corpus, write_json

LABELS = ["clean", "agreement", "verb-form", "spelling", "punctuation"]


def examples(rows, vocabulary, frequency):
    output = []
    for row in rows:
        tokens, tags = row["tokens"], row["tags"]
        targets = []
        for index, (word, head, relation) in enumerate(
            zip(tokens, row["heads"], row["relations"], strict=True)
        ):
            if (
                relation == "nsubj"
                and head < len(tokens)
                and word.lower()
                not in {"i", "you", "none", "team", "staff", "family", "committee"}
            ):
                number = row["features"][index].get("Number")
                for predicate in [head] + [
                    j
                    for j, h in enumerate(row["heads"])
                    if h == head and row["relations"][j].split(":")[0] in {"aux", "cop"}
                ]:
                    original = tokens[predicate].lower()
                    other = {
                        "is": "are",
                        "are": "is",
                        "was": "were",
                        "were": "was",
                        "has": "have",
                        "have": "has",
                    }.get(original)
                    expected = "Sing" if original in {"is", "was", "has"} else "Plur"
                    if other and number == expected:
                        targets.append((predicate, other, "agreement", index))
            if (
                index > 0
                and tags[index] == "VERB"
                and tokens[index - 1].lower() in {"has", "have", "had"}
            ):
                other = {
                    "written": "wrote",
                    "gone": "went",
                    "seen": "saw",
                    "eaten": "ate",
                    "done": "did",
                    "taken": "took",
                    "given": "gave",
                }.get(word.lower())
                if other:
                    targets.append((index, other, "verb-form", -1))
        candidates = [
            i
            for i, word in enumerate(tokens)
            if word.isalpha()
            and word.islower()
            and 5 <= len(word) <= 16
            and frequency.get(word, 0) >= 5
            and tags[i] not in {"PROPN", "PUNCT"}
        ]
        if candidates:
            index = candidates[SEED % len(candidates)]
            word = tokens[index]
            position = 1 + SEED % (len(word) - 2)
            mutation = (
                word[:position]
                + word[position + 1]
                + word[position]
                + word[position + 2 :]
            )
            if mutation not in frequency and mutation != word:
                targets.append((index, mutation, "spelling", -1))
        for index, mutation, label, subject in targets:
            for corrupted in [False, True]:
                words = list(tokens)
                if corrupted:
                    words[index] = mutation
                context = [
                    index - 2,
                    index - 1,
                    index,
                    index + 1,
                    index + 2,
                    subject,
                    row["heads"][index],
                ]
                ids = [
                    vocabulary.get(words[j].lower(), 1) if 0 <= j < len(words) else 0
                    for j in context
                ]
                tag_ids = [
                    TAGS.index(tags[j]) + 1 if 0 <= j < len(words) else 0
                    for j in context
                ]
                # Features are derived only from observable word forms and lexicon membership.
                w = words[index].lower()
                number = (
                    row["features"][subject].get("Number") if subject >= 0 else None
                )
                numeric = [
                    float(w not in frequency),
                    1.0 if number == "Sing" else -1.0 if number == "Plur" else 0.0,
                    1.0
                    if w in {"is", "was", "has", "does"}
                    else -1.0
                    if w in {"are", "were", "have", "do"}
                    else 0.0,
                    float(
                        index > 0 and words[index - 1].lower() in {"has", "have", "had"}
                    ),
                    float(w in {"wrote", "went", "saw", "ate", "did", "took", "gave"}),
                    float(w.endswith("s")),
                ]
                output.append(
                    (ids, tag_ids, numeric, LABELS.index(label) if corrupted else 0)
                )
    return output


class Classifier(nn.Module):
    def __init__(self, size):
        super().__init__()
        self.word = nn.Embedding(size, 24, padding_idx=0)
        self.tag = nn.Embedding(len(TAGS) + 1, 6, padding_idx=0)
        self.network = nn.Sequential(
            nn.Linear(216, 64), nn.ReLU(), nn.Linear(64, len(LABELS))
        )

    def forward(self, words, tags, features):
        return self.network(
            torch.cat(
                [self.word(words).flatten(1), self.tag(tags).flatten(1), features],
                dim=1,
            )
        )


def tensors(data):
    return (
        torch.tensor([r[0] for r in data], dtype=torch.long),
        torch.tensor([r[1] for r in data], dtype=torch.long),
        torch.tensor([r[2] for r in data], dtype=torch.float32),
        torch.tensor([r[3] for r in data], dtype=torch.long),
    )


def main():
    random.seed(SEED)
    np.random.seed(SEED)
    torch.manual_seed(SEED)
    torch.set_num_threads(4)
    out = ROOT / "models/generated/ewt-1"
    metadata = json.loads((out / "tagger-manifest.json").read_text(encoding="utf-8"))
    lexicon = json.loads((out / "lexicon.json").read_text(encoding="utf-8"))
    vocabulary, frequency = metadata["vocabulary"], lexicon["frequency"]
    rows = {
        name: read_corpus(ROOT / f"training/datasets/raw/ewt/en_ewt-ud-{suffix}.conllu")
        for name, suffix in [
            ("train", "train"),
            ("validation", "dev"),
            ("test", "test"),
        ]
    }
    seen = {tuple(r["tokens"]) for r in rows["train"]}
    rows["validation"] = [
        r for r in rows["validation"] if tuple(r["tokens"]) not in seen
    ]
    seen.update(tuple(r["tokens"]) for r in rows["validation"])
    rows["test"] = [r for r in rows["test"] if tuple(r["tokens"]) not in seen]
    data = {
        name: examples(split, vocabulary, frequency) for name, split in rows.items()
    }
    train, validation, test = [
        tensors(data[name]) for name in ["train", "validation", "test"]
    ]
    model = Classifier(len(vocabulary))
    optimizer = torch.optim.AdamW(model.parameters(), lr=0.003)
    counts = Counter(int(x) for x in train[3])
    weights = torch.tensor(
        [len(train[3]) / max(1, counts[i]) for i in range(len(LABELS))]
    )
    weights /= weights.mean()
    best, state = -1, None
    for epoch in range(10):
        model.train()
        order = torch.randperm(len(train[3]))
        for start in range(0, len(order), 256):
            idx = order[start : start + 256]
            optimizer.zero_grad()
            loss = nn.functional.cross_entropy(
                model(*[x[idx] for x in train[:3]]), train[3][idx], weight=weights
            )
            loss.backward()
            optimizer.step()
        model.eval()
        with torch.no_grad():
            score = float(
                (model(*validation[:3]).argmax(1) == validation[3]).float().mean()
            )
        print(
            json.dumps(
                {"event": "classifier", "epoch": epoch + 1, "validationAccuracy": score}
            ),
            flush=True,
        )
        if score > best:
            best, state = score, copy.deepcopy(model.state_dict())
    model.load_state_dict(state)
    model.eval()
    with torch.no_grad():
        validation_scores = model(*validation[:3]).numpy()
        test_scores = model(*test[:3]).numpy()
    calibrators, metrics = {}, {}
    # Split validation by source sentence order; test never participates in fitting/threshold choice.
    cutoff = len(validation[3]) // 2
    for i, label in enumerate(LABELS[1:], 1):
        labels = (validation[3].numpy() == i).astype(int)
        if labels[:cutoff].sum() < 5:
            calibrators[label] = {
                "available": False,
                "reason": "Insufficient calibration support",
            }
            continue
        calibrator = LogisticRegression(random_state=SEED).fit(
            validation_scores[:cutoff, i : i + 1], labels[:cutoff]
        )
        probabilities = calibrator.predict_proba(validation_scores[cutoff:, i : i + 1])[
            :, 1
        ]
        threshold = 1.0
        for candidate in np.linspace(0.5, 0.99, 50):
            selected = probabilities >= candidate
            if selected.sum() >= 30 and labels[cutoff:][selected].mean() >= 0.95:
                threshold = float(candidate)
                break
        test_probability = calibrator.predict_proba(test_scores[:, i : i + 1])[:, 1]
        predicted = test_probability >= threshold
        expected = (test[3].numpy() == i).astype(int)
        p, r, f, _ = precision_recall_fscore_support(
            expected, predicted, average="binary", zero_division=0
        )
        metrics[label] = {
            "precision": float(p),
            "recall": float(r),
            "f1": float(f),
            "brier": float(brier_score_loss(expected, test_probability)),
            "positives": int(expected.sum()),
            "predictions": int(predicted.sum()),
        }
        calibrators[label] = {
            "available": True,
            "a": float(calibrator.coef_[0, 0]),
            "b": float(calibrator.intercept_[0]),
            "threshold": threshold,
            "scope": "Verified synthetic mutations on EWT; not natural learner essays",
            "releaseGate": bool(p >= 0.95 and r >= 0.75 and expected.sum() >= 100),
        }
    torch.onnx.export(
        model,
        tuple(x[:1] for x in train[:3]),
        str(out / "error-classifier.onnx"),
        input_names=["words", "tags", "features"],
        output_names=["scores"],
        dynamic_axes={
            "words": {0: "tokens"},
            "tags": {0: "tokens"},
            "features": {0: "tokens"},
            "scores": {0: "tokens"},
        },
        opset_version=17,
        dynamo=False,
    )
    session = ort.InferenceSession(
        str(out / "error-classifier.onnx"), providers=["CPUExecutionProvider"]
    )
    actual = session.run(
        None,
        {
            "words": test[0][:20].numpy(),
            "tags": test[1][:20].numpy(),
            "features": test[2][:20].numpy(),
        },
    )[0]
    difference = float(np.abs(actual - test_scores[:20]).max())
    if difference > 0.0001:
        raise ValueError("Classifier ONNX parity failed")
    bigrams = Counter(
        (a.lower(), b.lower())
        for row in rows["train"]
        for a, b in zip(["<s>"] + row["tokens"], row["tokens"] + ["</s>"], strict=True)
    )
    contextual = {
        "version": "ewt-1",
        "unigrams": dict(frequency),
        "bigrams": {a + "\u0000" + b: c for (a, b), c in bigrams.most_common(80000)},
        "total": sum(frequency.values()),
        "smoothing": 0.1,
        "scope": "EWT edited/web prose; low likelihood is not ungrammaticality",
    }
    write_json(out / "contextual.json", contextual)
    write_json(
        out / "classifier-manifest.json",
        {
            "version": "ewt-1",
            "task": "error-classifier",
            "artifact": "error-classifier.onnx",
            "sha256": hashlib.sha256(
                (out / "error-classifier.onnx").read_bytes()
            ).hexdigest(),
            "labels": LABELS,
            "calibration": calibrators,
            "evaluation": metrics,
            "pythonOnnxMaximumDifference": difference,
            "provenance": metadata["provenance"],
            "training": {
                "seed": SEED,
                "examples": {k: len(v) for k, v in data.items()},
                "splitPolicy": "Official splits with exact sentence deduplication; training generates controlled mutations; author identities unavailable",
            },
            "limitations": [
                "Synthetic-error evaluation does not establish natural-essay precision",
                "Categories failing gates are review-only",
                "Punctuation lacks enough training examples and is disabled",
            ],
        },
    )
    print(json.dumps({"event": "classifier-complete", "metrics": metrics}), flush=True)


if __name__ == "__main__":
    main()
