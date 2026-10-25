"""Train real local discriminative syntax assets on pinned UD EWT. No generated prose."""

import argparse
import copy
import hashlib
import importlib.metadata
import json
import random
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch
from checkpoint_registry import record_checkpoint
from ewt_splits import verified_corpus_manifest
from torch import nn
from ud_english_sources import load_training_rows

ROOT = Path(__file__).resolve().parents[1]
TAGS = [
    "ADJ",
    "ADP",
    "ADV",
    "AUX",
    "CCONJ",
    "DET",
    "INTJ",
    "NOUN",
    "NUM",
    "PART",
    "PRON",
    "PROPN",
    "PUNCT",
    "SCONJ",
    "SYM",
    "VERB",
    "X",
]
SEED = 1729


def read_corpus(path):
    rows, current, meta = [], [], {}
    for line in path.read_text(encoding="utf-8").splitlines() + [""]:
        if line.startswith("# ") and " = " in line:
            key, value = line[2:].split(" = ", 1)
            meta[key] = value
        elif line and not line.startswith("#"):
            fields = line.split("\t")
            if fields[0].isdigit():
                current.append(fields)
        elif not line and current:
            if 1 <= len(current) <= 128 and all(
                int(f[0]) == i + 1 for i, f in enumerate(current)
            ):
                rows.append(
                    {
                        "id": meta.get("sent_id", str(len(rows))),
                        "group": meta.get("sent_id", str(len(rows))).rsplit("-", 1)[0],
                        "tokens": [f[1] for f in current],
                        "tags": [f[3] for f in current],
                        "lemmas": [f[2] for f in current],
                        "features": [
                            dict(v.split("=", 1) for v in f[5].split("|") if "=" in v)
                            for f in current
                        ],
                        "heads": [
                            int(f[6]) - 1 if int(f[6]) else len(current)
                            for f in current
                        ],
                        "relations": [f[7] for f in current],
                    }
                )
            current, meta = [], {}
    return rows


class Tagger(nn.Module):
    def __init__(self, words, characters):
        super().__init__()
        self.word = nn.Embedding(words, 64, padding_idx=0)
        self.char = nn.Embedding(characters, 16, padding_idx=0)
        self.cnn = nn.Conv1d(16, 32, 3, padding=1)
        self.lstm = nn.LSTM(96, 64, batch_first=True, bidirectional=True)
        self.output = nn.Linear(128, len(TAGS))

    def forward(self, words, chars, lengths):
        batch, length, width = chars.shape
        c = self.char(chars).reshape(batch * length, width, 16).transpose(1, 2)
        c = torch.relu(self.cnn(c)).amax(dim=2).reshape(batch, length, 32)
        x = torch.cat([self.word(words), c], dim=2)
        packed = nn.utils.rnn.pack_padded_sequence(
            x, lengths.cpu(), batch_first=True, enforce_sorted=False
        )
        hidden, _ = self.lstm(packed)
        padded, _ = nn.utils.rnn.pad_packed_sequence(
            hidden, batch_first=True, total_length=words.shape[1]
        )
        return self.output(padded)


class CRF(nn.Module):
    def __init__(self):
        super().__init__()
        self.transitions = nn.Parameter(torch.zeros(len(TAGS), len(TAGS)))
        self.start = nn.Parameter(torch.zeros(len(TAGS)))
        self.end = nn.Parameter(torch.zeros(len(TAGS)))

    def loss(self, emissions, tags, lengths):
        score = self.start + emissions[:, 0]
        gold = self.start[tags[:, 0]] + emissions[:, 0].gather(1, tags[:, :1]).squeeze(
            1
        )
        for i in range(1, emissions.shape[1]):
            active = lengths > i
            update = (
                torch.logsumexp(
                    score.unsqueeze(2) + self.transitions.unsqueeze(0), dim=1
                )
                + emissions[:, i]
            )
            score = torch.where(active.unsqueeze(1), update, score)
            gold = (
                gold
                + (
                    self.transitions[tags[:, i - 1], tags[:, i]]
                    + emissions[:, i].gather(1, tags[:, i : i + 1]).squeeze(1)
                )
                * active
            )
        last = tags.gather(1, (lengths - 1).unsqueeze(1)).squeeze(1)
        return (torch.logsumexp(score + self.end, dim=1) - gold - self.end[last]).mean()


def encode(rows, vocabulary, characters):
    length = max(len(row["tokens"]) for row in rows)
    words = torch.zeros(len(rows), length, dtype=torch.long)
    chars = torch.zeros(len(rows), length, 24, dtype=torch.long)
    tags = torch.zeros(len(rows), length, dtype=torch.long)
    lengths = torch.tensor([len(row["tokens"]) for row in rows], dtype=torch.long)
    for i, row in enumerate(rows):
        for j, token in enumerate(row["tokens"]):
            words[i, j] = vocabulary.get(token.lower(), 1)
            tags[i, j] = TAGS.index(row["tags"][j])
            for k, char in enumerate(token[:24]):
                chars[i, j, k] = characters.get(char, 1)
    return words, chars, lengths, tags


def decode(emissions, transitions, start, end):
    scores, back = start + emissions[0], []
    for row in emissions[1:]:
        matrix = scores[:, None] + transitions
        previous = matrix.argmax(axis=0)
        scores = matrix[previous, np.arange(len(TAGS))] + row
        back.append(previous)
    tag, path = int((scores + end).argmax()), []
    path.append(tag)
    for previous in reversed(back):
        tag = int(previous[tag])
        path.append(tag)
    return path[::-1]


def evaluate_tagger(model, crf, rows, vocabulary, characters):
    model.eval()
    correct, count = 0, 0
    transitions, start, end = [
        p.detach().numpy() for p in [crf.transitions, crf.start, crf.end]
    ]
    with torch.no_grad():
        for offset in range(0, len(rows), 64):
            batch = rows[offset : offset + 64]
            words, chars, lengths, _ = encode(batch, vocabulary, characters)
            values = model(words, chars, lengths).numpy()
            for i, row in enumerate(batch):
                predicted = decode(
                    values[i, : len(row["tokens"])], transitions, start, end
                )
                row["predictedTags"] = [TAGS[t] for t in predicted]
                correct += sum(
                    TAGS[p] == t for p, t in zip(predicted, row["tags"], strict=True)
                )
                count += len(predicted)
    return {"tokenAccuracy": correct / count, "tokens": count, "sentences": len(rows)}


class ParserScorer(nn.Module):
    def __init__(self, words, actions):
        super().__init__()
        self.word = nn.Embedding(words, 32, padding_idx=0)
        self.tag = nn.Embedding(len(TAGS) + 2, 8, padding_idx=0)
        self.network = nn.Sequential(
            nn.Linear(400, 128), nn.ReLU(), nn.Linear(128, actions)
        )

    def forward(self, words, tags):
        return self.network(
            torch.cat([self.word(words), self.tag(tags)], dim=2).flatten(1)
        )


def state_features(state, row, vocabulary, predicted=False):
    stack, pointer, _heads, _relations, left, right, _score = state
    n = len(row["tokens"])
    top = [stack[-1 - i] if len(stack) > i else -1 for i in range(3)]
    indices = top + [pointer + i if pointer + i < n else -1 for i in range(3)]
    indices += [
        left[top[0]] if top[0] >= 0 else -1,
        right[top[0]] if top[0] >= 0 else -1,
        left[top[1]] if top[1] >= 0 else -1,
        right[top[1]] if top[1] >= 0 else -1,
    ]
    words = [
        0 if i < 0 else 2 if i == n else vocabulary.get(row["tokens"][i].lower(), 1)
        for i in indices
    ]
    tags = [
        0
        if i < 0
        else 1
        if i == n
        else TAGS.index(
            row.get("predictedTags", row["tags"])[i] if predicted else row["tags"][i]
        )
        + 2
        for i in indices
    ]
    return words, tags


def initial_state(n):
    return ([n], 0, [-1] * n, ["dep"] * n, [-1] * (n + 1), [-1] * (n + 1), 0.0)


def advance(state, action):
    stack, pointer, heads, relations, left, right, score = copy.deepcopy(state)
    if action == "SHIFT":
        stack.append(pointer)
        pointer += 1
    else:
        direction, relation = action.split(":", 1)
        head, dependent = (
            (stack[-1], stack[-2]) if direction == "LEFT" else (stack[-2], stack[-1])
        )
        heads[dependent], relations[dependent] = head, relation
        left[head] = dependent if left[head] < 0 else min(left[head], dependent)
        right[head] = max(right[head], dependent)
        stack.pop(-2 if direction == "LEFT" else -1)
    return stack, pointer, heads, relations, left, right, score


def oracle(row, vocabulary):
    n = len(row["tokens"])
    remaining = Counter(row["heads"])
    state, examples = initial_state(n), []
    for _ in range(2 * n + 1):
        stack, pointer = state[:2]
        if pointer == n and len(stack) == 1:
            return examples
        action = None
        if len(stack) >= 2:
            a, b = stack[-2:]
            if a < n and row["heads"][a] == b and remaining[a] == 0:
                action = "LEFT:" + row["relations"][a]
                remaining[b] -= 1
            elif b < n and row["heads"][b] == a and remaining[b] == 0:
                action = "RIGHT:" + row["relations"][b]
                remaining[a] -= 1
        if action is None:
            if pointer >= n:
                return []  # Non-projective tree; explicitly count excluded oracle sentences.
            action = "SHIFT"
        examples.append((*state_features(state, row, vocabulary), action))
        state = advance(state, action)
    return []


def parse(session, row, vocabulary, actions, beam_width=4):
    n, beam = len(row["tokens"]), [initial_state(len(row["tokens"]))]
    for _ in range(2 * n):
        features = [state_features(s, row, vocabulary, predicted=True) for s in beam]
        logits = session.run(
            None,
            {
                "words": np.array([x[0] for x in features], dtype=np.int64),
                "tags": np.array([x[1] for x in features], dtype=np.int64),
            },
        )[0]
        expanded = []
        for state, scores in zip(beam, logits, strict=True):
            stack, pointer = state[:2]
            valid = []
            for i, action in enumerate(actions):
                allowed = (
                    pointer < n
                    if action == "SHIFT"
                    else len(stack) >= 2
                    and (
                        stack[-2] < n
                        if action.startswith("LEFT:")
                        else stack[-1] < n
                        and (stack[-2] < n or pointer == n and len(stack) == 2)
                    )
                )
                if allowed:
                    valid.append(i)
            if not valid:
                continue
            denominator = np.logaddexp.reduce(scores[valid])
            for i in sorted(valid, key=lambda j: float(scores[j]), reverse=True)[
                :beam_width
            ]:
                next_state = advance(state, actions[i])
                expanded.append(
                    (*next_state[:6], state[6] + float(scores[i] - denominator))
                )
        beam = sorted(expanded, key=lambda s: s[6], reverse=True)[:beam_width]
        if not beam:
            return initial_state(n)
    return beam[0]


def write_json(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(content, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--epochs", type=int, default=12)
    parser.add_argument("--parser-epochs", type=int, default=6)
    parser.add_argument("--lexicon-only", action="store_true")
    args = parser.parse_args()
    random.seed(SEED)
    np.random.seed(SEED)
    torch.manual_seed(SEED)
    torch.set_num_threads(4)
    out = ROOT / "models/generated/ewt-1"
    out.mkdir(parents=True, exist_ok=True)
    corpus = ROOT / "training/datasets/raw/ewt"
    provenance, _ = verified_corpus_manifest(ROOT)
    # The manifest is provenance only when the bytes being trained on still match
    # the pinned release. Check before either full training or lexicon-only output.
    seen, groups, splits, excluded = set(), set(), {}, {}
    for split, suffix in [("train", "train"), ("validation", "dev"), ("test", "test")]:
        rows = read_corpus(corpus / f"en_ewt-ud-{suffix}.conllu")
        filtered = [
            r
            for r in rows
            if tuple(r["tokens"]) not in seen and r["group"] not in groups
        ]
        excluded[split] = len(rows) - len(filtered)
        seen.update(tuple(r["tokens"]) for r in filtered)
        groups.update(r["group"] for r in filtered)
        splits[split] = filtered
    supplemental_rows, supplemental_provenance = load_training_rows(ROOT, read_corpus)
    retained_supplemental = []
    for row in supplemental_rows:
        sentence = tuple(row["tokens"])
        if sentence in seen:
            continue
        seen.add(sentence)
        retained_supplemental.append(row)
    splits["train"].extend(retained_supplemental)
    frequency = Counter(t.lower() for r in splits["train"] for t in r["tokens"])
    vocabulary = {"<pad>": 0, "<unk>": 1, "<root>": 2}
    vocabulary.update(
        {
            word: i + 3
            for i, (word, count) in enumerate(
                sorted((w, c) for w, c in frequency.items() if c >= 2)
            )
        }
    )
    characters = {"<pad>": 0, "<unk>": 1}
    characters.update(
        {
            c: i + 2
            for i, c in enumerate(
                sorted({c for r in splits["train"] for t in r["tokens"] for c in t})
            )
        }
    )
    lexical = defaultdict(dict)
    for row in splits["train"]:
        for word, lemma, pos, features in zip(
            row["tokens"], row["lemmas"], row["tags"], row["features"], strict=True
        ):
            item = {"lemma": lemma, "pos": pos}
            if features.get("Number") in {"Sing", "Plur"}:
                item["number"] = (
                    "singular" if features["Number"] == "Sing" else "plural"
                )
            if features.get("Person") in {"1", "2", "3"}:
                item["person"] = int(features["Person"])
            if pos in {"AUX", "VERB"}:
                item["finite"] = features.get("VerbForm") == "Fin"
                item["verbForm"] = features.get("VerbForm", "")
                item["tense"] = features.get("Tense", "")
            lexical[word.lower()][json.dumps(item, sort_keys=True)] = item
    lexicon = {
        "version": "ewt-1",
        "source": provenance["source"],
        "license": provenance["license"],
        "additionalSources": supplemental_provenance["sources"],
        "forms": {w: list(forms.values()) for w, forms in lexical.items()},
        "frequency": dict(frequency),
    }
    write_json(out / "lexicon.json", lexicon)
    if args.lexicon_only:
        print(
            json.dumps({"event": "lexicon", "forms": len(lexicon["forms"])}), flush=True
        )
        return
    model, crf = Tagger(len(vocabulary), len(characters)), CRF()
    optimizer = torch.optim.AdamW(
        list(model.parameters()) + list(crf.parameters()), lr=0.003
    )
    batches = [
        encode(
            sorted(splits["train"], key=lambda r: len(r["tokens"]))[i : i + 64],
            vocabulary,
            characters,
        )
        for i in range(0, len(splits["train"]), 64)
    ]
    best, best_state = -1, None
    print(
        json.dumps(
            {
                "event": "data",
                "splits": {k: len(v) for k, v in splits.items()},
                "excludedDuplicatesOrDocuments": excluded,
                "vocabulary": len(vocabulary),
            }
        ),
        flush=True,
    )
    for epoch in range(args.epochs):
        random.shuffle(batches)
        model.train()
        loss_total = 0
        for words, chars, lengths, labels in batches:
            optimizer.zero_grad()
            loss = crf.loss(model(words, chars, lengths), labels, lengths)
            loss.backward()
            nn.utils.clip_grad_norm_(
                list(model.parameters()) + list(crf.parameters()), 5
            )
            optimizer.step()
            loss_total += float(loss.detach())
        metrics = evaluate_tagger(
            model, crf, splits["validation"], vocabulary, characters
        )
        print(
            json.dumps(
                {"event": "tagger", "epoch": epoch + 1, "loss": loss_total, **metrics}
            ),
            flush=True,
        )
        if metrics["tokenAccuracy"] > best:
            best, best_state = (
                metrics["tokenAccuracy"],
                (copy.deepcopy(model.state_dict()), copy.deepcopy(crf.state_dict())),
            )
    model.load_state_dict(best_state[0])
    crf.load_state_dict(best_state[1])
    model.eval()
    tag_test = evaluate_tagger(model, crf, splits["test"], vocabulary, characters)
    words, chars, lengths, _ = encode(splits["validation"][:1], vocabulary, characters)
    torch.onnx.export(
        model,
        (words, chars, lengths),
        str(out / "tagger.onnx"),
        input_names=["words", "chars", "lengths"],
        output_names=["emissions"],
        dynamic_axes={
            "words": {0: "batch", 1: "tokens"},
            "chars": {0: "batch", 1: "tokens"},
            "lengths": {0: "batch"},
            "emissions": {0: "batch", 1: "tokens"},
        },
        opset_version=17,
        dynamo=False,
    )
    session_options = ort.SessionOptions()
    session_options.intra_op_num_threads = 1
    session = ort.InferenceSession(
        str(out / "tagger.onnx"), session_options, providers=["CPUExecutionProvider"]
    )
    differences, parity = [], []
    for row in splits["validation"][:20]:
        w, c, length, _ = encode([row], vocabulary, characters)
        with torch.no_grad():
            reference = model(w, c, length).numpy()
        actual = session.run(
            None, {"words": w.numpy(), "chars": c.numpy(), "lengths": length.numpy()}
        )[0]
        differences.append(float(np.abs(reference - actual).max()))
        parity.append(
            {
                "words": w[0].tolist(),
                "chars": c[0].tolist(),
                "tokens": row["tokens"],
                "emissions": actual[0].tolist(),
            }
        )
    if max(differences) > 0.0001:
        raise ValueError("ONNX encoder parity failed")
    metadata = {
        "version": "ewt-1",
        "language": "en-US",
        "vocabulary": vocabulary,
        "characters": characters,
        "tags": TAGS,
        "transitions": crf.transitions.detach().tolist(),
        "startScores": crf.start.detach().tolist(),
        "endScores": crf.end.detach().tolist(),
        "provenance": [
            provenance,
            {
                "manifest": "training/datasets/ud-english-manifest.json",
                "sources": supplemental_provenance["sources"],
                "corpusHashes": supplemental_provenance["corpusHashes"],
            },
        ],
        "training": {
            "seed": SEED,
            "epochs": args.epochs,
            "splitPolicy": provenance["splitPolicy"],
            "excluded": excluded,
            "supplementalTraining": supplemental_provenance,
            "dependencies": {
                name: importlib.metadata.version(name)
                for name in ["torch", "numpy", "onnx", "onnxruntime"]
            },
            "quantization": "float32",
        },
        "evaluation": {
            "tagger": tag_test,
            "validationAccuracy": best,
            "pythonOnnxMaximumDifference": max(differences),
        },
        "limitations": [
            "The parser and tagger are trained on English EWT plus licensed English treebanks; these corpora do not represent a validated learner-essay population",
            "OANC written text contributes contextual candidate-ranking counts only; its automatic annotations are not treated as gold syntax or learner-error labels",
            "Document-disjoint and exact-deduplicated official splits; author/prompt independence unverified",
            "POS and parser scores are not calibrated grammatical-error confidence",
        ],
    }
    write_json(out / "parity.json", parity)
    write_json(
        out / "tagger-manifest.json",
        {
            **metadata,
            "task": "pos",
            "artifact": "tagger.onnx",
            "sha256": hashlib.sha256((out / "tagger.onnx").read_bytes()).hexdigest(),
            "inputSchema": {
                "words": "int64[B,N]",
                "chars": "int64[B,N,24]",
                "lengths": "int64[B]",
            },
            "outputSchema": {"emissions": "float32[B,N,17]"},
            "calibration": {"status": "not a grammar-confidence model"},
        },
    )
    tagger_checkpoint = out / "tagger.pt"
    torch.save(
        {"model": model.state_dict(), "crf": crf.state_dict(), "metadata": metadata},
        tagger_checkpoint,
    )
    record_checkpoint(
        "tagger.pt",
        tagger_checkpoint,
        {
            "task": "POS tagger",
            "corpusManifests": [
                "training/datasets/ewt-manifest.json",
                "training/datasets/ud-english-manifest.json",
            ],
            "evaluation": tag_test,
            "validationAccuracy": best,
            "epochs": args.epochs,
        },
    )
    print(json.dumps({"event": "tagger-exported", **tag_test}), flush=True)
    examples = [item for row in splits["train"] for item in oracle(row, vocabulary)]
    actions = sorted({item[2] for item in examples})
    xw = torch.tensor([e[0] for e in examples], dtype=torch.long)
    xt = torch.tensor([e[1] for e in examples], dtype=torch.long)
    y = torch.tensor([actions.index(e[2]) for e in examples], dtype=torch.long)
    scorer = ParserScorer(len(vocabulary), len(actions))
    optimizer = torch.optim.AdamW(scorer.parameters(), lr=0.002)
    for epoch in range(args.parser_epochs):
        order = torch.randperm(len(y))
        correct, total_loss = 0, 0
        scorer.train()
        for i in range(0, len(order), 1024):
            idx = order[i : i + 1024]
            optimizer.zero_grad()
            logits = scorer(xw[idx], xt[idx])
            loss = nn.functional.cross_entropy(logits, y[idx])
            loss.backward()
            optimizer.step()
            correct += int((logits.argmax(1) == y[idx]).sum())
            total_loss += float(loss.detach())
        print(
            json.dumps(
                {
                    "event": "parser",
                    "epoch": epoch + 1,
                    "oracleActionAccuracy": correct / len(y),
                    "loss": total_loss,
                }
            ),
            flush=True,
        )
    scorer.eval()
    torch.onnx.export(
        scorer,
        (xw[:1], xt[:1]),
        str(out / "parser.onnx"),
        input_names=["words", "tags"],
        output_names=["scores"],
        dynamic_axes={
            "words": {0: "states"},
            "tags": {0: "states"},
            "scores": {0: "states"},
        },
        opset_version=17,
        dynamo=False,
    )
    parser_session = ort.InferenceSession(
        str(out / "parser.onnx"), session_options, providers=["CPUExecutionProvider"]
    )
    uas, las, total = 0, 0, 0
    for index, row in enumerate(splits["test"]):
        words, chars, lengths, _ = encode([row], vocabulary, characters)
        emissions = session.run(
            None,
            {
                "words": words.numpy(),
                "chars": chars.numpy(),
                "lengths": lengths.numpy(),
            },
        )[0][0]
        row["predictedTags"] = [
            TAGS[i]
            for i in decode(
                emissions,
                crf.transitions.detach().numpy(),
                crf.start.detach().numpy(),
                crf.end.detach().numpy(),
            )
        ]
        state = parse(parser_session, row, vocabulary, actions)
        for head, relation, gold_head, gold_relation in zip(
            state[2], state[3], row["heads"], row["relations"], strict=True
        ):
            uas += head == gold_head
            las += head == gold_head and relation == gold_relation
            total += 1
        if index % 500 == 0:
            print(json.dumps({"event": "parser-test", "sentences": index}), flush=True)
    parser_metrics = {
        "uas": uas / total,
        "las": las / total,
        "tokens": total,
        "sentences": len(splits["test"]),
        "beamWidth": 4,
        "pos": "predicted",
        "trainingOracleExamples": len(examples),
        "nonprojectiveTrainingSentencesExcluded": sum(
            not oracle(row, vocabulary) for row in splits["train"]
        ),
    }
    write_json(
        out / "parser-manifest.json",
        {
            **metadata,
            "task": "parser",
            "training": {
                **metadata["training"],
                "epochs": args.parser_epochs,
                "configuration": {
                    "epochs": args.parser_epochs,
                    "beamWidth": 4,
                    "featurePositions": 10,
                    "transitionSystem": "arc-standard",
                    "maximumTokens": 128,
                },
            },
            "artifact": "parser.onnx",
            "sha256": hashlib.sha256((out / "parser.onnx").read_bytes()).hexdigest(),
            "actions": actions,
            "evaluation": parser_metrics,
            "inputSchema": {"words": "int64[B,10]", "tags": "int64[B,10]"},
            "outputSchema": {"scores": "float32[B,A]"},
            "calibration": {"status": "beam scores uncalibrated"},
        },
    )
    write_json(out / "metrics.json", {"tagger": tag_test, "parser": parser_metrics})
    parser_checkpoint = out / "parser.pt"
    torch.save(
        {
            "model": scorer.state_dict(),
            "actions": actions,
            "metadata": metadata,
            "training": {
                "epochs": args.parser_epochs,
                "seed": SEED,
                "transitionSystem": "arc-standard",
                "beamWidth": 4,
                "trainingOracleExamples": len(examples),
            },
            "evaluation": parser_metrics,
        },
        parser_checkpoint,
    )
    record_checkpoint(
        "parser.pt",
        parser_checkpoint,
        {
            "task": "transition-based dependency parser",
            "corpusManifests": [
                "training/datasets/ewt-manifest.json",
                "training/datasets/ud-english-manifest.json",
            ],
            "evaluation": parser_metrics,
            "epochs": args.parser_epochs,
        },
    )
    print(
        json.dumps({"event": "complete", "tagger": tag_test, "parser": parser_metrics}),
        flush=True,
    )


if __name__ == "__main__":
    main()
