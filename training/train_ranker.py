"""Fit correction ranking to train-only controlled corruptions; evaluate untouched test data."""

import json
import math
import random
from collections import Counter, defaultdict

import numpy as np
from sklearn.linear_model import LogisticRegression
from train_release import ROOT, SEED, read_corpus, write_json


def main():
    random.seed(SEED)
    out = ROOT / "models/generated/ewt-1"
    contextual = json.loads((out / "contextual.json").read_text(encoding="utf-8"))
    splits = {
        name: read_corpus(ROOT / f"training/datasets/raw/ewt/en_ewt-ud-{name}.conllu")
        for name in ["train", "dev", "test"]
    }
    seen = {tuple(r["tokens"]) for r in splits["train"]}
    for name in ["dev", "test"]:
        splits[name] = [r for r in splits[name] if tuple(r["tokens"]) not in seen]
        seen.update(tuple(r["tokens"]) for r in splits[name])
    bigrams = Counter(
        (a.lower(), b.lower())
        for row in splits["train"]
        for a, b in zip(["<s>"] + row["tokens"], row["tokens"] + ["</s>"], strict=True)
    )
    followers, continuation, totals = Counter(), Counter(), Counter()
    for (a, b), count in bigrams.items():
        followers[a] += 1
        continuation[b] += 1
        totals[a] += count
    # Interpolated absolute-discount Kneser-Ney bigram, fitted on training counts.
    counts = Counter(bigrams.values())
    discount = counts[1] / max(1, counts[1] + 2 * counts[2])
    discount = max(0.1, min(0.9, discount))
    contextual.update(
        unigrams=dict(totals),
        continuation=dict(continuation),
        followers=dict(followers),
        totalTypes=len(bigrams),
        discount=discount,
    )
    vocabulary = [
        w
        for w, count in totals.items()
        if count >= 3 and w.isalpha() and 5 <= len(w) <= 20
    ]
    deletion = defaultdict(set)
    for word in vocabulary:
        for i in range(len(word)):
            deletion[word[:i] + word[i + 1 :]].add(word)

    def features(a, b, word):
        def probability(x, y):
            cont = continuation.get(y, 1) / len(bigrams)
            return math.log(
                max(
                    1e-12,
                    (
                        max(0, bigrams.get((x, y), 0) - discount)
                        + discount * followers[x] * cont
                    )
                    / totals[x]
                    if totals[x]
                    else cont,
                )
            )

        return [
            math.log1p(totals[word]),
            probability(a, word) + probability(word, b),
            -1,
        ]

    def examples(rows):
        result = []
        for row in rows:
            words = ["<s>"] + [w.lower() for w in row["tokens"]] + ["</s>"]
            for i in range(1, len(words) - 1):
                word = words[i]
                if word not in vocabulary_set:
                    continue
                position = random.randrange(len(word))
                typo = word[:position] + word[position + 1 :]
                candidates = sorted(deletion[typo], key=lambda w: (-totals[w], w))[:20]
                if word not in candidates or len(candidates) < 2:
                    continue
                result.append(
                    (
                        word,
                        candidates,
                        [features(words[i - 1], words[i + 1], c) for c in candidates],
                    )
                )
        return result

    vocabulary_set = set(vocabulary)
    data = {name: examples(rows) for name, rows in splits.items()}
    x, y = [], []
    for target, candidates, values in data["train"]:
        correct = values[candidates.index(target)]
        for candidate, value in zip(candidates, values, strict=True):
            if candidate != target:
                difference = np.array(correct) - np.array(value)
                x.extend([difference, -difference])
                y.extend([1, 0])
    model = LogisticRegression(random_state=SEED, fit_intercept=False).fit(x, y)
    metrics = {}
    for name, items in data.items():
        correct = sum(
            candidates[int(np.argmax(np.array(values) @ model.coef_[0]))] == target
            for target, candidates, values in items
        )
        metrics[name] = {
            "groups": len(items),
            "top1Accuracy": correct / len(items) if items else None,
        }
    contextual["ranking"] = {
        "coefficients": model.coef_[0].tolist(),
        "intercept": 0,
        "scope": "EWT controlled single-deletion candidates; train-only pairwise logistic fit; not natural correction accuracy",
    }
    write_json(out / "contextual.json", contextual)
    write_json(
        ROOT / "reports/ranker-evaluation.json",
        {
            "seed": SEED,
            "metrics": metrics,
            "smoothing": "Interpolated absolute-discount Kneser-Ney bigram",
            "discount": discount,
            "scope": contextual["ranking"]["scope"],
        },
    )
    print(json.dumps(metrics))


if __name__ == "__main__":
    main()
