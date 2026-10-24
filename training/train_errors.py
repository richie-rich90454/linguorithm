"""Train a compact contextual error classifier and calibrators on verified synthetic mutations.

These scores are calibrated for this synthetic task, not for naturally occurring essay errors.
"""

import argparse
import copy
import hashlib
import json
import multiprocessing
import random
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor
from functools import lru_cache

import numpy as np
import onnxruntime as ort
import torch
from predicted_syntax import PredictedSyntaxFeatures
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, precision_recall_fscore_support
from torch import nn
from train_release import ROOT, SEED, TAGS, read_corpus, write_json

LABELS = ["clean", "agreement", "verb-form", "spelling", "punctuation"]
FEATURE_POLICY = "predicted-syntax-corpus-paradigms-document-groups-v4"
_FEATURE_PREDICTOR = None
_MUTATION_PARADIGMS = None


class MutationParadigms:
    """Attested training-only forms select labels, never classifier features.

    Paradigm cells with competing spellings are omitted. Syncretic forms cannot
    create an error: a replacement must not also occupy the original cell.
    """

    def __init__(self, rows):
        self.finite = defaultdict(set)
        self.past = defaultdict(set)
        self.participles = defaultdict(set)
        for row in rows:
            for word, lemma, pos, features in zip(
                row["tokens"], row["lemmas"], row["tags"], row["features"], strict=True
            ):
                word, lemma = word.lower(), lemma.lower()
                if (
                    pos not in {"AUX", "VERB"}
                    or not word.isascii()
                    or not word.isalpha()
                    or not lemma.isascii()
                    or not lemma.isalpha()
                    or features.get("Typo") == "Yes"
                ):
                    continue
                if (
                    features.get("VerbForm") == "Part"
                    and features.get("Tense") == "Past"
                ):
                    self.participles[(lemma, pos)].add(word)
                if (
                    features.get("VerbForm") == "Fin"
                    and features.get("Mood") == "Ind"
                    and features.get("Tense") in {"Pres", "Past"}
                ):
                    if features["Tense"] == "Past":
                        self.past[(lemma, pos)].add(word)
                    self.finite[
                        (
                            lemma,
                            pos,
                            features["Tense"],
                            features.get("Number"),
                            features.get("Person"),
                        )
                    ].add(word)

    @staticmethod
    def _case(source, replacement):
        if source.islower():
            return replacement
        if source.isupper():
            return replacement.upper()
        if source.istitle():
            return replacement.capitalize()
        return None

    def agreement(self, row, predicate, subject):
        subject_features = row["features"][subject]
        number = subject_features.get("Number")
        person = subject_features.get("Person")
        if number not in {"Sing", "Plur"} or person not in {None, "3"}:
            return None
        if row["tags"][subject] not in {"NOUN", "PROPN", "PRON"}:
            return None
        if row["tags"][subject] == "PRON" and (
            person != "3" or subject_features.get("PronType") != "Prs"
        ):
            return None
        features = row["features"][predicate]
        if (
            features.get("VerbForm") != "Fin"
            or features.get("Mood") != "Ind"
            or features.get("Number") != number
            or features.get("Person") != "3"
            or features.get("Typo") == "Yes"
        ):
            return None
        lemma, pos = row["lemmas"][predicate].lower(), row["tags"][predicate]
        source = row["tokens"][predicate]
        original = self.finite.get(
            (lemma, pos, features.get("Tense"), number, "3"), set()
        )
        target = self.finite.get(
            (
                lemma,
                pos,
                features.get("Tense"),
                "Plur" if number == "Sing" else "Sing",
                "3",
            ),
            set(),
        )
        if source.lower() not in original or len(target) != 1:
            return None
        replacement = next(iter(target))
        if replacement in original:
            return None
        return self._case(source, replacement)

    def verb_form(self, row, index):
        features = row["features"][index]
        if (
            row["tags"][index] != "VERB"
            or features.get("VerbForm") != "Part"
            or features.get("Tense") != "Past"
            or features.get("Typo") == "Yes"
        ):
            return None
        # Gold dependencies identify a controlled perfect construction. They do
        # not enter the predicted inputs and need not assume adjacent words.
        if not any(
            head == index
            and row["relations"][j].split(":")[0] == "aux"
            and row["tags"][j] == "AUX"
            and row["lemmas"][j].lower() == "have"
            for j, head in enumerate(row["heads"])
        ):
            return None
        lemma = row["lemmas"][index].lower()
        participles = self.participles.get((lemma, "VERB"), set())
        if row["tokens"][index].lower() not in participles:
            return None
        past = self.past.get((lemma, "VERB"), set())
        if len(past) != 1:
            return None
        replacement = next(iter(past))
        if replacement in participles:
            return None
        return self._case(row["tokens"][index], replacement)


@lru_cache(maxsize=1)
def default_mutation_paradigms():
    # The oracle baseline shares these labels, but must never learn mutation
    # forms from a validation or test call to examples().
    return MutationParadigms(
        read_corpus(ROOT / "training/datasets/raw/ewt/en_ewt-ud-train.conllu")
    )


def initialize_feature_worker(directory, paradigms):
    global _FEATURE_PREDICTOR, _MUTATION_PARADIGMS
    torch.set_num_threads(1)
    _FEATURE_PREDICTOR = PredictedSyntaxFeatures(directory)
    _MUTATION_PARADIGMS = paradigms


def prepare_feature_chunk(chunk):
    name, offset, rows = chunk
    predictor = _FEATURE_PREDICTOR
    # Scheduling must not affect cache hits, sample fixtures, or cohort counts.
    predictor.cache.clear()
    predictor.statistics.clear()
    predictor.fixtures.clear()
    values = examples(
        rows,
        predictor.metadata["vocabulary"],
        predictor.lexicon["frequency"],
        predictor,
        _MUTATION_PARADIGMS,
    )
    return (
        name,
        offset,
        len(rows),
        values,
        dict(predictor.statistics),
        list(predictor.fixtures),
    )


def prepare_features(rows, directory, workers):
    paradigms = MutationParadigms(rows["train"])
    chunks = [
        (name, offset, split[offset : offset + 200])
        for name, split in rows.items()
        for offset in range(0, len(split), 200)
    ]
    data = {name: [] for name in rows}
    cohorts = {name: Counter() for name in rows}
    fixtures = []
    hashes = {
        name: hashlib.sha256((directory / name).read_bytes()).hexdigest()
        for name in [
            "tagger.onnx",
            "parser.onnx",
            "lexicon.json",
            "tagger-manifest.json",
            "parser-manifest.json",
        ]
    }

    def collect(results):
        # Executor.map preserves input order, regardless of worker completion order.
        for name, offset, count, values, statistics, samples in results:
            data[name].extend(values)
            cohorts[name].update(statistics)
            fixtures.extend(samples[: max(0, 30 - len(fixtures))])
            print(
                json.dumps(
                    {
                        "event": "predicted-classifier-features",
                        "split": name,
                        "sourceRows": offset + count,
                        "examples": len(data[name]),
                        "workers": workers,
                        "cohort": dict(cohorts[name]),
                    }
                ),
                flush=True,
            )

    if workers == 1:
        initialize_feature_worker(directory, paradigms)
        collect(map(prepare_feature_chunk, chunks))
    else:
        with ProcessPoolExecutor(
            max_workers=workers,
            mp_context=multiprocessing.get_context("spawn"),
            initializer=initialize_feature_worker,
            initargs=(directory, paradigms),
        ) as pool:
            collect(pool.map(prepare_feature_chunk, chunks, chunksize=1))
    return (
        data,
        {name: dict(value) for name, value in cohorts.items()},
        hashes,
        fixtures,
    )


def examples(rows, vocabulary, frequency, predictor=None, paradigms=None):
    """Gold annotation selects labels only when predictor is supplied.

    The no-predictor branch is retained for the separately named oracle-feature
    classical baseline; it is never used to fit or evaluate the deployed model.
    """
    output = []
    paradigms = paradigms or default_mutation_paradigms()
    for row_number, row in enumerate(rows):
        if predictor is not None and row_number and row_number % 500 == 0:
            print(
                json.dumps(
                    {
                        "event": "predicting-classifier-features",
                        "sourceRows": row_number,
                        "retainedExamples": len(output),
                    }
                ),
                flush=True,
            )
        tokens, tags = row["tokens"], row["tags"]
        if predictor is not None:
            original_features = predictor.extract(tokens)
            if original_features is not None:
                # Edited EWT is assumed clean for this controlled task. Sample across
                # predicted POS, never gold POS, to expose non-target words at training,
                # calibration and evaluation time rather than evaluating target-only.
                ranked = sorted(
                    range(len(tokens)),
                    key=lambda i: hashlib.sha256(
                        (" ".join(tokens) + "\0" + str(i)).encode("utf-8")
                    ).digest(),
                )
                selected, observed_tags = [], set()
                for index in ranked:
                    tag = original_features[index][1][2]
                    if tag not in observed_tags and len(selected) < 4:
                        selected.append(index)
                        observed_tags.add(tag)
                selected.extend(i for i in ranked if i not in selected)
                for index in selected[:4]:
                    ids, tag_ids, numeric = original_features[index]
                    output.append((ids, tag_ids, numeric, 0, row["group"]))
                    predictor.statistics["cleanControlExamples"] += 1
        targets = []
        for index, (word, head, relation) in enumerate(
            zip(tokens, row["heads"], row["relations"], strict=True)
        ):
            if relation == "nsubj" and head < len(tokens):
                for predicate in [head] + [
                    j
                    for j, h in enumerate(row["heads"])
                    if h == head and row["relations"][j].split(":")[0] in {"aux", "cop"}
                ]:
                    other = paradigms.agreement(row, predicate, index)
                    if other:
                        targets.append((predicate, other, "agreement", index))
            other = paradigms.verb_form(row, index)
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
                if predictor is not None:
                    predicted = predictor.extract(words)
                    if predicted is not None:
                        ids, tag_ids, numeric = predicted[index]
                        output.append(
                            (
                                ids,
                                tag_ids,
                                numeric,
                                LABELS.index(label) if corrupted else 0,
                                row["group"],
                            )
                        )
                    continue
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
                    (
                        ids,
                        tag_ids,
                        numeric,
                        LABELS.index(label) if corrupted else 0,
                    )
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
    arguments = argparse.ArgumentParser()
    mode = arguments.add_mutually_exclusive_group()
    mode.add_argument(
        "--prepare-features",
        action="store_true",
        help="Run frozen syntax inference and save features; do not train or package models",
    )
    mode.add_argument(
        "--train",
        action="store_true",
        help="Train using prepared features after browser feature parity has passed",
    )
    arguments.add_argument(
        "--workers",
        type=int,
        choices=range(1, 5),
        default=4,
        help="Feature-preparation processes, each with one ONNX thread (1–4)",
    )
    args = arguments.parse_args()
    random.seed(SEED)
    np.random.seed(SEED)
    torch.manual_seed(SEED)
    torch.set_num_threads(4)
    out = ROOT / "models/generated/ewt-1"
    metadata = json.loads((out / "tagger-manifest.json").read_text(encoding="utf-8"))
    lexicon = json.loads((out / "lexicon.json").read_text(encoding="utf-8"))
    vocabulary, frequency = metadata["vocabulary"], lexicon["frequency"]
    corpus_manifest = json.loads(
        (ROOT / "training/datasets/ewt-manifest.json").read_text(encoding="utf-8")
    )
    corpus_hashes = {}
    for suffix in ["train", "dev", "test"]:
        name = f"en_ewt-ud-{suffix}.conllu"
        actual = hashlib.sha256(
            (ROOT / "training/datasets/raw/ewt" / name).read_bytes()
        ).hexdigest()
        if actual != corpus_manifest["files"][name]["sha256"]:
            raise ValueError(f"Pinned classifier corpus hash mismatch: {name}")
        corpus_hashes[name] = actual
    rows = {
        name: read_corpus(ROOT / f"training/datasets/raw/ewt/en_ewt-ud-{suffix}.conllu")
        for name, suffix in [
            ("train", "train"),
            ("validation", "dev"),
            ("test", "test"),
        ]
    }
    seen, groups, split_exclusions = set(), set(), {}
    for name in ["train", "validation", "test"]:
        source = rows[name]
        rows[name] = [
            r
            for r in source
            if tuple(r["tokens"]) not in seen and r["group"] not in groups
        ]
        split_exclusions[name] = len(source) - len(rows[name])
        seen.update(tuple(r["tokens"]) for r in rows[name])
        groups.update(r["group"] for r in rows[name])
    feature_path = out / "classifier-predicted-features.json"
    fixture_path = out / "classifier-feature-parity.json"
    if args.train:
        prepared = json.loads(feature_path.read_text(encoding="utf-8"))
        if (
            prepared.get("schemaVersion") != 4
            or prepared.get("featurePolicy") != FEATURE_POLICY
        ):
            raise ValueError(
                "Prepared features predate training-only corpus mutation paradigms; rerun --prepare-features"
            )
        if prepared.get("corpusHashes") != corpus_hashes:
            raise ValueError(
                "Prepared classifier features have stale or unpinned corpus hashes"
            )
        if any(
            len(row) != 5 or not isinstance(row[4], str) or not row[4]
            for split in prepared["data"].values()
            for row in split
        ):
            raise ValueError(
                "Prepared classifier examples need source document-group identities"
            )
        data, feature_cohorts, feature_model_hashes = (
            prepared["data"],
            prepared["cohorts"],
            prepared["hashes"],
        )
        if set(feature_model_hashes) != {
            "tagger.onnx",
            "parser.onnx",
            "lexicon.json",
            "tagger-manifest.json",
            "parser-manifest.json",
        }:
            raise ValueError(
                "Prepared features must bind all five frozen syntax resources"
            )
        for name, expected in feature_model_hashes.items():
            if hashlib.sha256((out / name).read_bytes()).hexdigest() != expected:
                raise ValueError(
                    "Prepared classifier features are stale; frozen syntax resources changed"
                )
    else:
        data, feature_cohorts, feature_model_hashes, feature_fixtures = (
            prepare_features(rows, out, args.workers)
        )
        write_json(
            fixture_path,
            {
                "schemaVersion": 1,
                "featurePolicy": FEATURE_POLICY,
                "scope": "Frozen predicted syntax; ASCII tokenization-stable cohort with learned subject morphology",
                "hashes": feature_model_hashes,
                "fixtures": feature_fixtures,
            },
        )
        write_json(
            feature_path,
            {
                "schemaVersion": 4,
                "featurePolicy": FEATURE_POLICY,
                "data": data,
                "cohorts": feature_cohorts,
                "hashes": feature_model_hashes,
                "corpusHashes": corpus_hashes,
                "mutationPolicy": "Unique attested UD training-only lemma/POS/morphology paradigms; third-person indicative number contrasts and dependency-linked perfect participles versus finite past; ambiguous or syncretic targets abstain",
            },
        )
    if args.prepare_features:
        return
    parity_path = ROOT / "reports/classifier-feature-parity.json"
    if not parity_path.exists():
        raise ValueError(
            "Run browser classifier feature parity on prepared fixtures before --train"
        )
    parity = json.loads(parity_path.read_text(encoding="utf-8"))
    if (
        parity.get("status") != "passed"
        or parity.get("featureFixtureSha256")
        != hashlib.sha256(fixture_path.read_bytes()).hexdigest()
    ):
        raise ValueError(
            "Browser classifier feature parity is missing, failed, or stale"
        )
    train, validation, test = [
        tensors(data[name]) for name in ["train", "validation", "test"]
    ]
    torch.set_num_threads(4)
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
    # Entire source documents stay on one side, including clean controls and all
    # mutation pairs. Test documents never participate in calibration or tuning.
    validation_groups = sorted(
        {row[4] for row in data["validation"]},
        key=lambda group: hashlib.sha256(f"{SEED}:{group}".encode()).digest(),
    )
    fit_groups = set(validation_groups[: len(validation_groups) // 2])
    fit_mask = np.array(
        [row[4] in fit_groups for row in data["validation"]], dtype=bool
    )
    threshold_mask = ~fit_mask
    calibration_groups = {
        "fit": sorted(fit_groups),
        "threshold": sorted(set(validation_groups) - fit_groups),
    }

    def emission_mask(split, label):
        center_tags = np.array([row[1][2] for row in data[split]])
        permitted = (
            ["AUX", "VERB"]
            if label == "agreement"
            else ["VERB"]
            if label == "verb-form"
            else TAGS
        )
        return np.isin(center_tags, [TAGS.index(tag) + 1 for tag in permitted])

    for i, label in enumerate(LABELS[1:], 1):
        if label == "spelling":
            calibrators[label] = {
                "available": False,
                "reason": "Auxiliary training class only; browser never emits neural spelling findings and uses dictionary candidate retrieval instead",
            }
            continue
        labels = (validation[3].numpy() == i).astype(int)
        if (
            any(
                labels[mask].sum() < 5 or (1 - labels[mask]).sum() < 5
                for mask in [fit_mask, threshold_mask]
            )
            or labels[threshold_mask & emission_mask("validation", label)].sum() < 5
        ):
            calibrators[label] = {
                "available": False,
                "reason": "Insufficient positive or negative support across disjoint calibration document groups",
            }
            continue
        calibrator = LogisticRegression(random_state=SEED).fit(
            validation_scores[fit_mask, i : i + 1], labels[fit_mask]
        )
        probabilities = calibrator.predict_proba(
            validation_scores[threshold_mask, i : i + 1]
        )[:, 1]
        threshold = None
        for candidate in np.linspace(0.5, 0.99, 50):
            selected = (probabilities >= candidate) & emission_mask(
                "validation", label
            )[threshold_mask]
            if selected.sum() >= 30 and labels[threshold_mask][selected].mean() >= 0.95:
                threshold = float(candidate)
                break
        if threshold is None:
            calibrators[label] = {
                "available": False,
                "reason": "No source-disjoint validation threshold achieved 95% precision with at least 30 POS-eligible predictions",
            }
            continue
        test_probability = calibrator.predict_proba(test_scores[:, i : i + 1])[:, 1]
        predicted = (test_probability >= threshold) & emission_mask("test", label)
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
            "scope": "Synthetic EWT mutations with frozen predicted syntax; tokenization-stable cohort, not natural learner essays",
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
    if (
        actual.shape != (20, len(LABELS))
        or not np.isfinite(actual).all()
        or not np.isfinite(difference)
        or difference > 0.0001
    ):
        raise ValueError("Classifier ONNX parity failed")
    score_fixture_path = out / "classifier-scores-parity.json"
    weight_hash = hashlib.sha256(
        (out / "error-classifier.onnx").read_bytes()
    ).hexdigest()
    write_json(
        score_fixture_path,
        {
            "schemaVersion": 1,
            "scope": "Actual newly trained ONNX classifier scores on first 20 held-out predicted-feature inputs",
            "hashes": feature_model_hashes,
            "weightSha256": weight_hash,
            "labels": LABELS,
            "inputs": {
                "words": test[0][:20].tolist(),
                "tags": test[1][:20].tolist(),
                "features": test[2][:20].tolist(),
            },
            "scores": actual.tolist(),
            "tolerance": 0.0001,
        },
    )
    score_fixture_hash = hashlib.sha256(score_fixture_path.read_bytes()).hexdigest()
    examples_by_label = {
        split: {
            label: sum(row[3] == index for row in values)
            for index, label in enumerate(LABELS)
        }
        for split, values in data.items()
    }
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
            "sha256": weight_hash,
            "labels": LABELS,
            "calibration": calibrators,
            "evaluation": metrics,
            "evaluationScope": "Token-level held-out controlled mutations before the runtime three-findings-per-sentence cap and hybrid conflict resolution; use reports/generalization.json for end-to-end production emissions.",
            "pythonOnnxMaximumDifference": difference,
            "provenance": metadata["provenance"],
            "training": {
                "seed": SEED,
                "examples": {k: len(v) for k, v in data.items()},
                "examplesByLabel": examples_by_label,
                "featureSource": "Frozen ONNX POS/CRF and beam parser predictions; learned lexical morphology only; no oracle syntax features",
                "featureModelHashes": feature_model_hashes,
                "featureCohorts": feature_cohorts,
                "corpusHashes": corpus_hashes,
                "calibrationDocumentGroups": calibration_groups,
                "emissionGuards": {
                    "agreement": ["AUX", "VERB"],
                    "verb-form": ["VERB"],
                    "spelling": [],
                },
                "featurePolicy": FEATURE_POLICY,
                "mutationPolicy": "Mutation labels use unique attested training-only lemma/POS/morphology paradigms; gold annotations select controlled targets only and never become classifier features",
                "splitExclusions": split_exclusions,
                "browserFeatureParity": parity,
                "browserScoreParityFixture": {
                    "path": score_fixture_path.name,
                    "sha256": score_fixture_hash,
                    "status": "requires browser verification",
                },
                "splitPolicy": "Official splits with exact sentence deduplication and document-group exclusions matching syntax training; controlled mutations; author identities unavailable",
            },
            "limitations": [
                "Synthetic-error evaluation does not establish natural-essay precision",
                "Clean control tokens are sampled across predicted POS from edited EWT assumed clean for the controlled task, not independently adjudicated learner writing",
                "Measured cohort excludes non-ASCII/tokenization-mismatched sequences and parsed subjects requiring browser fallback morphology",
                "Python/browser classifier feature parity must pass before packaging these artifacts",
                "Categories failing gates are review-only",
                "Punctuation lacks enough training examples and is disabled",
            ],
        },
    )
    print(json.dumps({"event": "classifier-complete", "metrics": metrics}), flush=True)


if __name__ == "__main__":
    main()
