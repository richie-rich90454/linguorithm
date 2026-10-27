"""Frozen-model classifier features, without oracle tags, heads, or morphology.

The retained cohort uses ASCII tokenization-stable sequences and learned lexical
entries for parsed subjects. This avoids pretending Python implements every
browser tokenizer/morphology fallback. Exclusions are counted explicitly.
"""

import hashlib
import json
import re
from collections import Counter, OrderedDict

import numpy as np
import onnxruntime as ort
from train_release import TAGS, decode, parse


def browser_tokens(text):
    """Exact ASCII subset of Tokenizer's Unicode pattern and contraction split."""
    if not text.isascii():
        return None
    output = []
    for match in re.finditer(
        r"[A-Za-z]+(?:'[A-Za-z]+)*|[0-9]+(?:[.,][0-9]+)*|[^\s]", text
    ):
        word = match.group()
        contraction = re.fullmatch(
            r"(.*?)(n't|'(?:m|re|ve|ll|d|s))", word, re.IGNORECASE
        )
        output.extend(
            contraction.groups() if contraction and contraction[1] else [word]
        )
    return output


class PredictedSyntaxFeatures:
    def __init__(self, directory):
        self.metadata = json.loads(
            (directory / "tagger-manifest.json").read_text(encoding="utf-8")
        )
        self.parser_metadata = json.loads(
            (directory / "parser-manifest.json").read_text(encoding="utf-8")
        )
        self.lexicon = json.loads(
            (directory / "lexicon.json").read_text(encoding="utf-8")
        )
        options = ort.SessionOptions()
        options.intra_op_num_threads = 1
        self.tagger = ort.InferenceSession(
            str(directory / "tagger.onnx"), options, providers=["CPUExecutionProvider"]
        )
        self.parser = ort.InferenceSession(
            str(directory / "parser.onnx"), options, providers=["CPUExecutionProvider"]
        )
        self.cache = OrderedDict()
        self.statistics = Counter()
        self.fixtures = []
        self.hashes = {
            name: hashlib.sha256((directory / name).read_bytes()).hexdigest()
            for name in [
                "tagger.onnx",
                "parser.onnx",
                "lexicon.json",
                "tagger-manifest.json",
                "parser-manifest.json",
            ]
        }

    def extract(self, tokens, strict=True):
        key = (tuple(tokens), strict)
        if key in self.cache:
            return self.cache[key]
        self.statistics["uniqueSequences"] += 1
        text = " ".join(tokens)
        if browser_tokens(text) != tokens or not 1 <= len(tokens) <= 128:
            self.statistics["excludedTokenizerOrLength"] += 1
            result = None
        else:
            result = self._predict(tokens, strict=strict)
        self.cache[key] = result
        if len(self.cache) > 512:
            self.cache.popitem(last=False)
        return result

    def _predict(self, tokens, strict=True):
        vocabulary, characters = (
            self.metadata["vocabulary"],
            self.metadata["characters"],
        )
        word_ids = [vocabulary.get(word.lower(), 1) for word in tokens]
        chars = np.zeros((1, len(tokens), 24), dtype=np.int64)
        for index, word in enumerate(tokens):
            for position, character in enumerate(word[:24]):
                chars[0, index, position] = characters.get(character, 1)
        emissions = self.tagger.run(
            None,
            {
                "words": np.array([word_ids], dtype=np.int64),
                "chars": chars,
                "lengths": np.array([len(tokens)], dtype=np.int64),
            },
        )[0][0]
        predicted = [
            TAGS[index]
            for index in decode(
                emissions,
                np.array(self.metadata["transitions"]),
                np.array(self.metadata["startScores"]),
                np.array(self.metadata["endScores"]),
            )
        ]
        # parse reads only tokens and predictedTags when predicted=True.
        row = {"tokens": tokens, "tags": predicted, "predictedTags": predicted}
        state = parse(self.parser, row, vocabulary, self.parser_metadata["actions"])
        heads, relations = state[2], state[3]
        if any(head < 0 for head in heads):
            self.statistics["excludedParserFailure"] += 1
            if strict:
                return None
            heads = [-1] * len(tokens)
            relations = ["dep"] * len(tokens)
        self.last_syntax = (predicted, heads, relations)
        output = []
        for index, word in enumerate(tokens):
            head = -1 if relations[index] == "root" else heads[index]
            subject = next(
                (
                    i
                    for i, relation in enumerate(relations)
                    if relation == "nsubj" and heads[i] in {index, head}
                ),
                -1,
            )
            number = None
            if subject >= 0:
                entries = self.lexicon["forms"].get(tokens[subject].lower())
                if entries is None:
                    self.statistics["excludedSubjectNeedsBrowserFallback"] += 1
                    if strict:
                        return None
                    entries = []
                numbers = {
                    entry["number"]
                    for entry in entries
                    if entry["pos"] == predicted[subject] and entry.get("number")
                }
                if len(numbers) == 1:
                    number = next(iter(numbers))
            context = [index - 2, index - 1, index, index + 1, index + 2, subject, head]
            ids = [word_ids[i] if 0 <= i < len(tokens) else 0 for i in context]
            tags = [
                TAGS.index(predicted[i]) + 1 if 0 <= i < len(tokens) else 0
                for i in context
            ]
            lowered = word.lower()
            numeric = [
                float(lowered not in self.lexicon["frequency"]),
                1.0 if number == "singular" else -1.0 if number == "plural" else 0.0,
                1.0
                if lowered in {"is", "was", "has", "does"}
                else -1.0
                if lowered in {"are", "were", "have", "do"}
                else 0.0,
                float(
                    index > 0 and tokens[index - 1].lower() in {"has", "have", "had"}
                ),
                float(
                    lowered in {"wrote", "went", "saw", "ate", "did", "took", "gave"}
                ),
                float(lowered.endswith("s")),
            ]
            output.append((ids, tags, numeric))
        self.statistics["retainedSequences"] += 1
        if len(self.fixtures) < 30:
            self.fixtures.append(
                {
                    "text": " ".join(tokens),
                    "tokens": tokens,
                    "tags": predicted,
                    "heads": heads,
                    "relations": relations,
                    "features": [
                        {"words": a, "tags": b, "numeric": c} for a, b, c in output
                    ],
                }
            )
        return output
