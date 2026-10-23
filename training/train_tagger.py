"""Offline character CNN + BiLSTM + linear-chain CRF POS training and ONNX export.

No corpora are downloaded. Input JSONL rows: tokens, tags, group, split.
Supply a dataset manifest with sha256, source, license, and permittedUse.
The supplied split must keep authors/prompts in disjoint groups.
"""

import argparse
import hashlib
import importlib.metadata
import json
import random
from pathlib import Path

import numpy as np
import torch
from torch import nn

TAGS = [
    "NOUN",
    "VERB",
    "AUX",
    "PRON",
    "DET",
    "ADJ",
    "ADV",
    "ADP",
    "CCONJ",
    "SCONJ",
    "PUNCT",
    "NUM",
    "X",
]


class Encoder(nn.Module):
    def __init__(self, vocabulary_size, character_size, tag_count):
        super().__init__()
        self.word_embedding = nn.Embedding(vocabulary_size, 64, padding_idx=0)
        self.character_embedding = nn.Embedding(character_size, 16, padding_idx=0)
        self.character_cnn = nn.Conv1d(16, 32, kernel_size=3, padding=1)
        self.lstm = nn.LSTM(96, 64, bidirectional=True, batch_first=True)
        self.output = nn.Linear(128, tag_count)

    def forward(self, words, chars):
        batch, length, width = chars.shape
        features = self.character_embedding(chars).reshape(batch * length, width, 16)
        encoded = torch.relu(self.character_cnn(features.transpose(1, 2))).amax(dim=2)
        combined = torch.cat(
            [self.word_embedding(words), encoded.reshape(batch, length, 32)], dim=2
        )
        output, _ = self.lstm(combined)
        return self.output(output)


class LinearChainCRF(nn.Module):
    def __init__(self, size):
        super().__init__()
        self.transitions = nn.Parameter(torch.zeros(size, size))
        self.start = nn.Parameter(torch.zeros(size))
        self.end = nn.Parameter(torch.zeros(size))

    def negative_log_likelihood(self, emissions, tags):
        # One sentence at a time: no padded tokens enter the partition function.
        scores = self.start + emissions[0]
        gold = self.start[tags[0]] + emissions[0, tags[0]]
        for position in range(1, len(tags)):
            scores = (
                torch.logsumexp(scores[:, None] + self.transitions, dim=0)
                + emissions[position]
            )
            gold = (
                gold
                + self.transitions[tags[position - 1], tags[position]]
                + emissions[position, tags[position]]
            )
        partition = torch.logsumexp(scores + self.end, dim=0)
        return partition - gold - self.end[tags[-1]]

    def decode(self, emissions):
        scores = self.start + emissions[0]
        back = []
        for row in emissions[1:]:
            best, previous = (scores[:, None] + self.transitions).max(dim=0)
            scores = best + row
            back.append(previous)
        tag = int((scores + self.end).argmax())
        path = [tag]
        for previous in reversed(back):
            tag = int(previous[tag])
            path.append(tag)
        return list(reversed(path))


def tensors(row, vocabulary, characters):
    words = torch.tensor(
        [[vocabulary.get(token.lower(), 1) for token in row["tokens"]]],
        dtype=torch.long,
    )
    chars = torch.zeros((1, len(row["tokens"]), 24), dtype=torch.long)
    for i, token in enumerate(row["tokens"]):
        for j, char in enumerate(token[:24]):
            chars[0, i, j] = characters.get(char, 1)
    return words, chars


def evaluate(encoder, crf, rows, vocabulary, characters):
    encoder.eval()
    correct, count = 0, 0
    with torch.no_grad():
        for row in rows:
            predicted = crf.decode(encoder(*tensors(row, vocabulary, characters))[0])
            expected = [TAGS.index(tag) for tag in row["tags"]]
            correct += sum(a == b for a, b in zip(predicted, expected, strict=True))
            count += len(expected)
    return {"tokenAccuracy": correct / count, "tokens": count, "sentences": len(rows)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dataset", type=Path)
    parser.add_argument("provenance", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--epochs", type=int, default=12)
    parser.add_argument("--seed", type=int, default=1729)
    args = parser.parse_args()
    if args.output.exists():
        raise ValueError(
            "Output must be a new directory. Never overwrite a reviewed artifact."
        )
    if args.epochs < 1:
        raise ValueError("Epochs must be positive.")
    provenance = json.loads(args.provenance.read_text(encoding="utf-8"))
    for field in ["source", "license", "permittedUse", "sha256"]:
        if not provenance.get(field):
            raise ValueError(f"Dataset manifest needs {field}")
    digest = hashlib.sha256(args.dataset.read_bytes()).hexdigest()
    if digest != provenance["sha256"]:
        raise ValueError("Dataset hash does not match provenance manifest.")
    rows = [
        json.loads(line)
        for line in args.dataset.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    groups = {}
    seen_sentences = {}
    for row in rows:
        if row.get("split") not in {"train", "validation", "test"} or not row.get(
            "group"
        ):
            raise ValueError(
                "Every sentence needs a split and an author/prompt-aware group."
            )
        if (
            not row.get("tokens")
            or len(row["tokens"]) != len(row.get("tags", []))
            or len(row["tokens"]) > 512
        ):
            raise ValueError(
                "Tokens and tags must have equal, nonzero lengths bounded to 512."
            )
        if any(tag not in TAGS for tag in row["tags"]):
            raise ValueError("Unknown universal POS tag.")
        if any(not isinstance(token, str) or not token for token in row["tokens"]):
            raise ValueError("Each token must be a nonempty string.")
        group = row["group"]
        if group in groups and groups[group] != row["split"]:
            raise ValueError("Group leakage across data splits.")
        groups[group] = row["split"]
        signature = tuple(row["tokens"])
        if signature in seen_sentences and seen_sentences[signature] != row["split"]:
            raise ValueError("Exact sentence leakage across data splits.")
        seen_sentences[signature] = row["split"]
    splits = {
        name: [row for row in rows if row["split"] == name]
        for name in ["train", "validation", "test"]
    }
    if any(not split for split in splits.values()):
        raise ValueError(
            "Train, validation, and held-out test splits must all be nonempty."
        )
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    torch.use_deterministic_algorithms(True)
    torch.set_num_threads(1)
    vocabulary = {"<pad>": 0, "<unk>": 1}
    characters = {"<pad>": 0, "<unk>": 1}
    for row in splits["train"]:
        for token in row["tokens"]:
            vocabulary.setdefault(token.lower(), len(vocabulary))
            for char in token:
                characters.setdefault(char, len(characters))
    encoder = Encoder(len(vocabulary), len(characters), len(TAGS))
    crf = LinearChainCRF(len(TAGS))
    optimizer = torch.optim.AdamW(
        list(encoder.parameters()) + list(crf.parameters()), lr=0.001
    )
    best, best_state = -1.0, None
    for epoch in range(args.epochs):
        encoder.train()
        random.shuffle(splits["train"])
        total = 0.0
        for row in splits["train"]:
            optimizer.zero_grad()
            emissions = encoder(*tensors(row, vocabulary, characters))[0]
            labels = torch.tensor(
                [TAGS.index(tag) for tag in row["tags"]], dtype=torch.long
            )
            loss = crf.negative_log_likelihood(emissions, labels)
            loss.backward()
            nn.utils.clip_grad_norm_(
                list(encoder.parameters()) + list(crf.parameters()), 5.0
            )
            optimizer.step()
            total += float(loss.detach())
        metrics = evaluate(encoder, crf, splits["validation"], vocabulary, characters)
        print(
            json.dumps(
                {"epoch": epoch + 1, "trainingLoss": total, "validation": metrics}
            )
        )
        if metrics["tokenAccuracy"] > best:
            best = metrics["tokenAccuracy"]
            best_state = (
                {k: v.clone() for k, v in encoder.state_dict().items()},
                {k: v.clone() for k, v in crf.state_dict().items()},
            )
    encoder.load_state_dict(best_state[0])
    crf.load_state_dict(best_state[1])
    encoder.eval()
    held_out = evaluate(encoder, crf, splits["test"], vocabulary, characters)
    args.output.mkdir(parents=True)
    artifact = args.output / "tagger.onnx"
    example = tensors(splits["validation"][0], vocabulary, characters)
    torch.onnx.export(
        encoder,
        example,
        str(artifact),
        input_names=["words", "chars"],
        output_names=["emissions"],
        dynamic_axes={
            "words": {1: "tokens"},
            "chars": {1: "tokens"},
            "emissions": {1: "tokens"},
        },
        opset_version=17,
        dynamo=False,
    )
    import onnxruntime as ort

    session = ort.InferenceSession(str(artifact), providers=["CPUExecutionProvider"])
    max_difference = 0.0
    with torch.no_grad():
        for row in splits["validation"][:20]:
            words, chars = tensors(row, vocabulary, characters)
            reference = encoder(words, chars).numpy()
            actual = session.run(
                None, {"words": words.numpy(), "chars": chars.numpy()}
            )[0]
            max_difference = max(
                max_difference, float(np.max(np.abs(reference - actual)))
            )
    if max_difference > 0.0001:
        raise ValueError(f"ONNX parity failed: {max_difference}")
    manifest = {
        "version": args.output.name,
        "task": "pos",
        "artifact": "tagger.onnx",
        "language": "en-US",
        "sha256": hashlib.sha256(artifact.read_bytes()).hexdigest(),
        "provenance": [provenance],
        "vocabulary": vocabulary,
        "characters": characters,
        "tags": TAGS,
        "transitions": crf.transitions.detach().tolist(),
        "startScores": crf.start.detach().tolist(),
        "endScores": crf.end.detach().tolist(),
        "inputSchema": {"words": "int64[1,N]", "chars": "int64[1,N,24]"},
        "outputSchema": {"emissions": f"float32[1,N,{len(TAGS)}]"},
        "training": {
            "seed": args.seed,
            "dependencies": {
                name: importlib.metadata.version(name)
                for name in ["torch", "numpy", "onnx", "onnxruntime"]
            },
            "configuration": {
                "epochs": args.epochs,
                "wordDimensions": 64,
                "characterDimensions": 16,
                "lstmHidden": 64,
            },
            "splitPolicy": "Explicit author/prompt groups; no cross-split group or exact sentence overlap",
            "quantization": "none",
        },
        "evaluation": {
            "test": held_out,
            "validationTokenAccuracy": best,
            "onnxMaximumEmissionDifference": max_difference,
        },
        "calibration": {
            "status": "not calibrated",
            "policy": "POS scores must not be presented as diagnostic confidence",
        },
        "limitations": [
            "Not promoted to production",
            "Domain and learner-text generalization requires independent evaluation",
            "Tagging accuracy alone does not establish grammar detection quality",
        ],
    }
    (args.output / "manifest.json").write_text(
        json.dumps(manifest, indent=4) + "\n", encoding="utf-8"
    )
    dependencies = sorted(
        f"{item.metadata['Name']}=={item.version}"
        for item in importlib.metadata.distributions()
    )
    (args.output / "requirements.lock.txt").write_text(
        "\n".join(dependencies) + "\n", encoding="utf-8"
    )
    print(
        json.dumps({"artifact": str(artifact), "heldOut": held_out, "promoted": False})
    )


if __name__ == "__main__":
    main()
