"""Fit correction ranking to train-only controlled corruptions; evaluate untouched test data."""

import hashlib
import json
import math
import random
from collections import Counter, defaultdict

import numpy as np
from ewt_splits import verified_splits
from ingest_oanc import ingest as ingest_oanc
from ingest_oanc import read_manifest as read_oanc_manifest
from oanc_context import iter_written_sentences
from sklearn.linear_model import LogisticRegression
from train_release import ROOT, SEED, read_corpus, write_json
from training_stats import wilson_interval
from ud_english_sources import load_evaluation_rows, load_training_rows


def main():
    random.seed(SEED)
    out = ROOT / "models/generated/ewt-1"
    contextual = json.loads((out / "contextual.json").read_text(encoding="utf-8"))
    splits, provenance = verified_splits(ROOT, read_corpus)
    supplemental_rows, supplemental_provenance = load_training_rows(ROOT, read_corpus)

    def normalized_sentence(tokens):
        joined = "".join(
            character.lower()
            for token in tokens
            for character in token
            if character.isalnum()
        )
        return hashlib.sha256(joined.encode("utf-8")).digest() if joined else b""

    heldout_hashes = {
        normalized_sentence(row["tokens"])
        for name in ("dev", "test")
        for row in splits[name]
    }
    heldout_rows = load_evaluation_rows(ROOT, read_corpus)
    heldout_hashes.update(
        normalized_sentence(row["tokens"])
        for source in heldout_rows.values()
        for row in source["rows"]
    )
    heldout_hashes.discard(b"")
    bigrams = Counter()
    for row in [*splits["train"], *supplemental_rows]:
        bigrams.update(
            (a.lower(), b.lower())
            for a, b in zip(
                ["<s>"] + row["tokens"], row["tokens"] + ["</s>"], strict=True
            )
        )
    oanc_provenance = ingest_oanc(ROOT)
    oanc_manifest = read_oanc_manifest(ROOT / "training/datasets/oanc-manifest.json")
    oanc_documents, oanc_sentences, oanc_tokens, oanc_heldout_duplicates = (
        set(),
        0,
        0,
        0,
    )
    oanc_path = ROOT / oanc_manifest["archivePath"]
    for document, tokens in iter_written_sentences(oanc_path):
        if normalized_sentence(tokens) in heldout_hashes:
            oanc_heldout_duplicates += 1
            continue
        oanc_documents.add(document)
        oanc_sentences += 1
        oanc_tokens += len(tokens)
        lower = [token.lower() for token in tokens]
        bigrams.update(zip(["<s>"] + lower, lower + ["</s>"], strict=True))
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
        bigrams={
            a + "\u0000" + b: count for (a, b), count in bigrams.most_common(80000)
        },
        unigrams=dict(totals),
        continuation=dict(continuation),
        followers=dict(followers),
        totalTypes=len(bigrams),
        discount=discount,
        trainingSources=supplemental_provenance["sources"],
        scope="Local context ranking from EWT and licensed UD training text plus written OANC; corpus likelihood is not a grammar judgment",
        contextSources={
            "oanc": {
                "id": "open-american-national-corpus-graf-2026-09-25",
                "archiveSha256": oanc_provenance["sha256"],
                "selectedDocuments": oanc_manifest["selectedDocuments"],
                "documents": len(oanc_documents),
                "sentences": oanc_sentences,
                "tokens": oanc_tokens,
                "exactHeldOutSentenceDuplicatesExcluded": oanc_heldout_duplicates,
                "collections": ["written_1", "written_2"],
                "role": "word and bigram context counts for candidate ranking only; no syntax or learner-error labels",
            },
            "ud": supplemental_provenance,
            "ewt": {"id": "ud-english-ewt-2.16", "role": "train split only"},
        },
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
            "correct": correct,
            "top1Accuracy": correct / len(items) if items else None,
            "top1Accuracy95PercentCI": wilson_interval(correct, len(items)),
        }
    contextual["ranking"] = {
        "coefficients": model.coef_[0].tolist(),
        "intercept": 0,
        "scope": "EWT controlled single-deletion candidates; train-only pairwise logistic fit; not natural correction accuracy",
    }
    write_json(out / "contextual.json", contextual)
    write_json(
        ROOT / "reports/candidate-ranker-evaluation.json",
        {
            "seed": SEED,
            **provenance,
            "supplementalTraining": supplemental_provenance,
            "contextSources": contextual["contextSources"],
            "contextCounts": {
                "bigramTypes": len(bigrams),
                "retainedBigramTypes": len(contextual["bigrams"]),
                "unigramTypes": len(totals),
            },
            "splitPolicy": "Official splits; exact token sequences and document groups excluded against earlier splits; train-only fit, no test tuning",
            "oancHeldOutOverlapPolicy": "Normalized exact sentence matches against EWT validation/test and every supplemental UD test split are excluded from OANC contextual counts; OANC has no labels and does not enter error-classifier evaluation.",
            "metrics": metrics,
            "smoothing": "Interpolated absolute-discount Kneser-Ney bigram",
            "discount": discount,
            "scope": contextual["ranking"]["scope"],
        },
    )
    print(json.dumps(metrics))


if __name__ == "__main__":
    main()
