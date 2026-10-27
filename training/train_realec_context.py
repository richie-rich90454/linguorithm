"""Train a compact REALEC token model on frozen parser features.

The model is a browser-runnable MLP over predicted POS, dependency relations,
head distance, morphology, and character features. It trains only on REALEC
train documents, selects one threshold on an internal document holdout, and
scores the development split once. The fixed test split is never opened.
"""

import argparse
import json
import math
import random
import sys
import unicodedata
from pathlib import Path

import numpy as np
import torch
from torch import nn

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "training"))
from predicted_syntax import PredictedSyntaxFeatures

BENCHMARK = ROOT / ".cache/datasets/realec/benchmark.json"
MODEL_DIR = ROOT / "models/generated/ewt-1"
OUTPUT = ROOT / ".cache/datasets/realec/context-model"
SEED = 20261027
EPOCHS = 12
MAX_TOKENS = 120
SPACE = set(
    " \t\n\r\f\v\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008"
    "\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
)
NORMALIZE = {
    "\u2018": "'",
    "\u2019": "'",
    "\u201c": '"',
    "\u201d": '"',
    "\u2013": "-",
    "\u2014": "-",
    "\u2026": ".",
    "\u00a0": " ",
    "\ufeff": " ",
}


def tokenize(text):
    output = []
    unit = 0
    index = 0
    while index < len(text):
        char = text[index]
        width = 2 if ord(char) > 0xFFFF else 1
        if char == "_" or unicodedata.category(char)[0] in {"L", "M", "N"}:
            start, start_unit = index, unit
            index += 1
            unit += width
            while index < len(text):
                char = text[index]
                width = 2 if ord(char) > 0xFFFF else 1
                if char == "_" or unicodedata.category(char)[0] in {"L", "M", "N"}:
                    index += 1
                    unit += width
                elif (
                    char in {"'", "\u2019"}
                    and index + 1 < len(text)
                    and (
                        text[index + 1] == "_"
                        or unicodedata.category(text[index + 1])[0] in {"L", "M", "N"}
                    )
                ):
                    index += 2
                    unit += width + (2 if ord(text[index - 1]) > 0xFFFF else 1)
                else:
                    break
            output.append((text[start:index], start_unit, unit))
            continue
        if char not in SPACE:
            output.append((char, unit, unit + width))
        index += 1
        unit += width
    return output


def normalize(text):
    return "".join(NORMALIZE.get(char, char) for char in text)


def split_sentences(spans):
    sentences = []
    start = 0
    for index, (text, _, _) in enumerate(spans):
        if text in {".", "!", "?"} or index - start + 1 >= MAX_TOKENS:
            sentences.append((start, index + 1))
            start = index + 1
    if start < len(spans):
        sentences.append((start, len(spans)))
    return sentences


def label_tokens(spans, annotations):
    labels = np.zeros(len(spans), dtype=np.uint8)
    for annotation in annotations:
        for start, end in annotation["spans"]:
            if start == end:
                index = next(
                    (i for i, (_, s, _) in enumerate(spans) if s >= start),
                    len(spans) - 1,
                )
                if index >= 0:
                    labels[index] = 1
                continue
            hit = False
            for index, (_, token_start, token_end) in enumerate(spans):
                if token_start < end and token_end > start:
                    labels[index] = 1
                    hit = True
            if not hit and spans:
                index = next(
                    (i for i, (_, s, _) in enumerate(spans) if s >= start),
                    len(spans) - 1,
                )
                labels[index] = 1
    return labels


def fnv(text):
    value = 2166136261
    for char in text:
        value ^= ord(char)
        value = (value * 16777619) & 0xFFFFFFFF
    return value


def char_features(word):
    vector = np.zeros(64, dtype=np.float32)
    lower = word.lower()
    for index, char in enumerate(lower):
        vector[fnv(f"c:{char}") % 64] = 1.0
        if index + 1 < len(lower):
            vector[fnv(f"b:{lower[index : index + 2]}") % 64] = 1.0
    for size in (2, 3, 4):
        if len(lower) >= size:
            vector[fnv(f"p{size}:{lower[:size]}") % 64] = 1.0
            vector[fnv(f"s{size}:{lower[-size:]}") % 64] = 1.0
    return vector


def read_data():
    benchmark = json.loads(BENCHMARK.read_text(encoding="utf-8"))
    return [d for d in benchmark["documents"] if d["split"] in {"train", "development"}]


def extract_rows(documents, predictor, vocabulary):
    rows = []
    for document in documents:
        spans = tokenize(document["text"])
        normalized = normalize(document["text"])
        normalized_spans = tokenize(normalized)
        if len(normalized_spans) != len(spans):
            continue
        labels = label_tokens(spans, document["annotations"])
        for start, end in split_sentences(normalized_spans):
            tokens = [t[0] for t in normalized_spans[start:end]]
            if not tokens or any(not token.isascii() for token in tokens):
                continue
            predictor.cache.clear()
            features = predictor.extract(tokens, strict=False)
            if features is None or predictor.last_syntax is None:
                continue
            _tags, heads, relations = predictor.last_syntax
            for local, (word_ids, tag_ids, numeric) in enumerate(features):
                index = start + local
                head = heads[local]
                relation = relations[local]
                head_relation = relations[head] if 0 <= head < len(relations) else ""
                distance = 0.0 if head < 0 or head == local else (head - local) / 8.0
                token = tokens[local]
                lower = token.lower()
                forms = predictor.lexicon["forms"].get(lower, [])
                numbers = {
                    entry.get("number") for entry in forms if entry.get("number")
                }
                number = (
                    1.0
                    if numbers == {"singular"}
                    else -1.0
                    if numbers == {"plural"}
                    else 0.0
                )
                person = (
                    1.0 if any(entry.get("person") == "3" for entry in forms) else 0.0
                )
                numeric_new = [
                    float(np.clip(distance, -1, 1)),
                    1.0 if relation in {"nsubj", "nsubj:pass"} else 0.0,
                    number,
                    person,
                    1.0 if tag_ids[3] in {2, 3} else 0.0,
                    1.0 if tag_ids[3] == 13 else 0.0,
                    1.0 if token[:1].isupper() else 0.0,
                    min(len(token), 16) / 16.0,
                    local / max(1, len(tokens)),
                    1.0 if local == 0 else 0.0,
                    1.0 if local + 1 == len(tokens) else 0.0,
                    1.0
                    if local and tokens[local - 1].lower() in {"the", "a", "an"}
                    else 0.0,
                    1.0
                    if local + 1 < len(tokens)
                    and tokens[local + 1] in {".", "!", "?", ",", ";"}
                    else 0.0,
                    float(head == local),
                    float(head_relation in {"acl", "acl:relcl", "advcl"}),
                ]
                rows.append(
                    {
                        "document": document["id"],
                        "split": document["split"],
                        "word_ids": word_ids,
                        "tag_ids": tag_ids,
                        "relation": relation,
                        "numeric": [*numeric, *numeric_new],
                        "chars": char_features(token),
                        "label": int(labels[index]),
                    }
                )
    return rows


def tensors(rows, vocabulary, tags, relations):
    words = torch.tensor([row["word_ids"] for row in rows], dtype=torch.long)
    tags_t = torch.tensor([row["tag_ids"] for row in rows], dtype=torch.long)
    relation = torch.tensor(
        [relations.get(row["relation"], 1) for row in rows], dtype=torch.long
    )
    numeric = torch.tensor([row["numeric"] for row in rows], dtype=torch.float32)
    chars = torch.tensor([row["chars"] for row in rows], dtype=torch.float32)
    labels = torch.tensor([row["label"] for row in rows], dtype=torch.float32)
    return words, tags_t, relation, numeric, chars, labels


class Model(nn.Module):
    def __init__(self, vocabulary, tags, relations, numeric_size):
        super().__init__()
        self.word = nn.Embedding(vocabulary, 48, padding_idx=0)
        self.tag = nn.Embedding(tags, 12, padding_idx=0)
        self.relation = nn.Embedding(relations, 8, padding_idx=0)
        self.numeric = nn.Linear(numeric_size, 16)
        self.chars = nn.Linear(64, 32)
        self.mlp = nn.Sequential(
            nn.Linear(7 * 48 + 7 * 12 + 8 + 16 + 32, 128),
            nn.ReLU(),
            nn.Dropout(0.25),
            nn.Linear(128, 64),
            nn.ReLU(),
            nn.Linear(64, 1),
        )

    def forward(self, words, tags, relation, numeric, chars):
        features = torch.cat(
            [
                self.word(words).flatten(1),
                self.tag(tags).flatten(1),
                self.relation(relation),
                torch.relu(self.numeric(numeric)),
                torch.relu(self.chars(chars)),
            ],
            dim=1,
        )
        return self.mlp(features).squeeze(-1)


def metrics(scores, labels, threshold):
    predicted = scores >= threshold
    gold = labels.astype(bool)
    tp = int((predicted & gold).sum())
    fp = int((predicted & ~gold).sum())
    fn = int((~predicted & gold).sum())
    tn = int((~predicted & ~gold).sum())
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    fpr = fp / (fp + tn) if fp + tn else 0.0
    error = (fp + fn) / max(1, len(labels))
    return {
        "counts": {"TP": tp, "FP": fp, "FN": fn, "TN": tn},
        "precision": precision,
        "recall": recall,
        "falsePositiveRate": fpr,
        "totalMisclassificationRate": error,
        "netDetections": tp - fp,
        "threshold": float(threshold),
    }


def select(scores, labels):
    thresholds = np.unique(np.quantile(scores, np.linspace(0, 0.999, 4000)))
    candidates = [metrics(scores, labels, float(t)) for t in thresholds]
    under = [m for m in candidates if m["falsePositiveRate"] < 0.0121]
    best = max(under, key=lambda m: (m["netDetections"], m["precision"]))
    best_recall = max(under, key=lambda m: (m["recall"], m["precision"]))
    precise = [m for m in candidates if m["precision"] >= 0.5]
    best_precision = (
        max(precise, key=lambda m: (m["recall"], m["netDetections"]))
        if precise
        else None
    )
    return best, best_recall, best_precision


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--train", action="store_true")
    args = parser.parse_args()
    random.seed(SEED)
    np.random.seed(SEED)
    torch.manual_seed(SEED)
    torch.set_num_threads(4)
    documents = read_data()
    predictor = PredictedSyntaxFeatures(MODEL_DIR)
    rows = extract_rows(documents, predictor, predictor.metadata["vocabulary"])
    print(
        json.dumps(
            {
                "rows": len(rows),
                "positive": sum(row["label"] for row in rows),
                "stats": predictor.statistics,
            }
        ),
        flush=True,
    )
    if not args.train:
        return
    train_rows = [
        row
        for row in rows
        if row["split"] == "train"
        and row["document"].split("_")[-1].isdigit()
        and int(row["document"].split("_")[-1]) % 7 != 0
    ]
    holdout_rows = [
        row
        for row in rows
        if row["split"] == "train"
        and row["document"].split("_")[-1].isdigit()
        and int(row["document"].split("_")[-1]) % 7 == 0
    ]
    vocabulary = int(max(max(row["word_ids"]) for row in rows)) + 1
    tags = int(max(max(row["tag_ids"]) for row in rows)) + 1
    relation_names = sorted({row["relation"] for row in rows})
    relations = {name: index + 1 for index, name in enumerate(relation_names)}
    numeric_size = len(rows[0]["numeric"])
    train = tensors(train_rows, vocabulary, tags, relations)
    holdout = tensors(holdout_rows, vocabulary, tags, relations)
    model = Model(vocabulary, tags, len(relations) + 1, numeric_size)
    positives = sum(row["label"] for row in train_rows)
    weight = torch.tensor(min(20.0, (len(train_rows) - positives) / max(1, positives)))
    loss_fn = nn.BCEWithLogitsLoss(pos_weight=weight)
    optimizer = torch.optim.AdamW(model.parameters(), lr=1.5e-3, weight_decay=1e-5)
    best_loss = math.inf
    best_state = None
    for epoch in range(EPOCHS):
        model.train()
        order = list(range(len(train_rows)))
        random.shuffle(order)
        total = 0.0
        for start in range(0, len(order), 256):
            batch = order[start : start + 256]
            words = train[0][batch]
            tags_t = train[1][batch]
            relation = train[2][batch]
            numeric = train[3][batch]
            chars = train[4][batch]
            labels = train[5][batch]
            optimizer.zero_grad()
            logits = model(words, tags_t, relation, numeric, chars)
            loss = loss_fn(logits, labels)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            total += float(loss) * len(batch)
        model.eval()
        with torch.no_grad():
            holdout_logits = model(
                holdout[0], holdout[1], holdout[2], holdout[3], holdout[4]
            )
            holdout_loss = float(
                nn.functional.binary_cross_entropy_with_logits(
                    holdout_logits, holdout[5]
                )
            )
        print(
            json.dumps(
                {
                    "epoch": epoch + 1,
                    "trainLoss": total / len(train_rows),
                    "holdoutLoss": holdout_loss,
                }
            ),
            flush=True,
        )
        if holdout_loss < best_loss:
            best_loss = holdout_loss
            best_state = {
                key: value.detach().clone() for key, value in model.state_dict().items()
            }
    model.load_state_dict(best_state)
    model.eval()
    with torch.no_grad():
        holdout_scores = torch.sigmoid(
            model(holdout[0], holdout[1], holdout[2], holdout[3], holdout[4])
        ).numpy()
        dev_documents = [d for d in documents if d["split"] == "development"]
        dev_rows = [
            row for row in rows if row["document"] in {d["id"] for d in dev_documents}
        ]
    dev = tensors(dev_rows, vocabulary, tags, relations)
    with torch.no_grad():
        dev_scores = torch.sigmoid(
            model(dev[0], dev[1], dev[2], dev[3], dev[4])
        ).numpy()
    best, best_recall, best_precision = select(holdout_scores, holdout[5].numpy())
    dev_metrics = metrics(dev_scores, dev[5].numpy(), best["threshold"])
    dev_recall_metrics = metrics(dev_scores, dev[5].numpy(), best_recall["threshold"])
    dev_precision_metrics = (
        metrics(dev_scores, dev[5].numpy(), best_precision["threshold"])
        if best_precision
        else None
    )
    result = {
        "dataset": {
            "documents": len(documents),
            "rows": len(rows),
            "positive": sum(row["label"] for row in rows),
        },
        "coverage": {
            "retainedRows": len(rows),
            "statistics": dict(predictor.statistics),
        },
        "holdout": {
            "rows": len(holdout_rows),
            "selected": best,
            "bestRecall": best_recall,
            "bestPrecision": best_precision,
        },
        "development": {
            "rows": len(dev_rows),
            "selected": dev_metrics,
            "bestRecall": dev_recall_metrics,
            "bestPrecision": dev_precision_metrics,
        },
    }
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / "report.json").write_text(
        json.dumps(result, indent=2) + "\n", encoding="utf-8"
    )
    torch.save(
        {
            "state": model.state_dict(),
            "vocabulary": vocabulary,
            "tags": tags,
            "relations": relations,
            "numericSize": numeric_size,
        },
        OUTPUT / "model.pt",
    )
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
