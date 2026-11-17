"""Build the second-generation REALEC benchmark split.

The v2 split removes documents whose text is near-duplicated across the frozen
train/development/test splits, then assigns whole writer-proxy clusters to a
70/15/15 document split. REALEC ships no author identifiers
(``authorIdentityAvailable`` is false), so writer similarity is inferred from
function-word usage and mean sentence/token length. This is a proxy: it can
merge different writers and split one writer, and the limitations string in the
report says so.

Outputs contain document ids and source spans only. Raw essay text is never
written to the manifest or the report. Both payloads are stable for the same
input: sorted keys, stable ordering, and ``generatedAt`` supplied by the caller.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import operator
import random
import unicodedata
from collections import Counter, defaultdict
from datetime import UTC
from itertools import combinations
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BENCHMARK_PATH = ROOT / ".cache/datasets/realec/benchmark.json"
V2_DIR = ROOT / ".cache/datasets/realec/v2"
MANIFEST_PATH = V2_DIR / "manifest.json"
REPORT_PATH = ROOT / "reports/benchmark-v2-manifest.json"

FORMAT = "linguorithm-realec-benchmark-v2"
SPLITS = ("train", "development", "test")
SPLIT_WEIGHTS = {"train": 0.70, "development": 0.15, "test": 0.15}
SEED = 20261117
SHINGLE_SIZE = 5
JACCARD_THRESHOLD = 0.8
WRITER_FUNCTION_WORDS = 120
# 0.985 is the specified proxy threshold. On the frozen cache it does not
# degenerate into one giant cluster (largest cluster holds 5 of 1202 documents);
# the threshold is kept rather than loosened.
WRITER_THRESHOLD = 0.985
PROBE_SENTENCES = 200
MAX_SENTENCE_TOKENS = 120
APOSTROPHES = {"'", "\u2019"}
WORD_CATEGORIES = frozenset({"L", "M", "N"})
# Closed-class English words. The top 120 present in the corpus are used.
_FUNCTION_WORD_TEXT = (
    "a about above after again against all almost along also "
    "although always am among an and another any anybody anyone "
    "anything are around as at be because been before being "
    "below between both but by can could did do does "
    "doing done down during each either else enough even ever "
    "every everybody everyone everything except few for from further get "
    "got had has have having he her here hers herself "
    "him himself his how however i if in into is "
    "it its itself just may me might more most much "
    "must my myself near neither never no nobody none nor "
    "not nothing now of off on once one only or "
    "other others otherwise our ours ourselves out over own per "
    "quite rather really same shall she should since so some "
    "somebody someone something sometimes still such than that the their "
    "theirs them themselves then there these they this those though "
    "through thus to too toward under until up upon us "
    "very via was we were what when where whether which "
    "while who whom whose why will with within without would "
    "yet you your yours yourself yourselves"
)
FUNCTION_WORDS = frozenset(_FUNCTION_WORD_TEXT.split())

LIMITATIONS = (
    "REALEC publishes no author or prompt identifiers (authorIdentityAvailable is false), so "
    "writer clusters are inferred from function-word frequencies and mean sentence/token length; "
    "the proxy can merge different writers and split one writer. Near-duplicate detection uses "
    "exact word 5-gram Jaccard overlap and cannot catch paraphrase or translation reuse; "
    "cross-split duplicates are dropped rather than reassigned. Split sizes target 70/15/15 by "
    "document, not by writer or token, and whole writer clusters move together only within the "
    "proxy's accuracy. The test split is evaluation-only and must not be used for training or "
    "tuning."
)


def tokenize(text):
    """Unicode word/punctuation tokens with UTF-16 offsets.

    Mirrors the evaluation tokenizer: words are letters/marks/numbers/underscore
    runs that may contain internal apostrophes, every other non-space character
    is its own token, and offsets count UTF-16 code units so they line up with
    REALEC annotation spans.
    """
    output = []
    index = 0
    unit = 0
    while index < len(text):
        char = text[index]
        width = 2 if ord(char) > 0xFFFF else 1
        if char == "_" or unicodedata.category(char)[0] in WORD_CATEGORIES:
            start, start_unit = index, unit
            index += 1
            unit += width
            while index < len(text):
                char = text[index]
                width = 2 if ord(char) > 0xFFFF else 1
                if char == "_" or unicodedata.category(char)[0] in WORD_CATEGORIES:
                    index += 1
                    unit += width
                elif (
                    char in APOSTROPHES
                    and index + 1 < len(text)
                    and (
                        text[index + 1] == "_"
                        or unicodedata.category(text[index + 1])[0] in WORD_CATEGORIES
                    )
                ):
                    index += 2
                    unit += width + (2 if ord(text[index - 1]) > 0xFFFF else 1)
                else:
                    break
            output.append((text[start:index], start_unit, unit))
            continue
        if not char.isspace():
            output.append((char, unit, unit + width))
        index += 1
        unit += width
    return output


def sentences(tokens):
    """Token index ranges of sentences; terminators are .!? with a length cap."""
    output = []
    start = 0
    for index, (text, _, _) in enumerate(tokens):
        if text in {".", "!", "?"} or index - start + 1 >= MAX_SENTENCE_TOKENS:
            output.append((start, index + 1))
            start = index + 1
    if start < len(tokens):
        output.append((start, len(tokens)))
    return output


class Union:
    """Union-find over string ids with a deterministic lowest-id root."""

    def __init__(self, items):
        self.parent = {item: item for item in items}

    def find(self, item):
        root = item
        while self.parent[root] != root:
            root = self.parent[root]
        while self.parent[item] != root:
            self.parent[item], item = root, self.parent[item]
        return root

    def union(self, left, right):
        left, right = self.find(left), self.find(right)
        if left != right:
            self.parent[max(left, right)] = min(left, right)


def _groups(union):
    groups = defaultdict(list)
    for item in sorted(union.parent):
        groups[union.find(item)].append(item)
    return sorted(groups.values(), key=lambda group: group[0])


def shingles(tokens, size=SHINGLE_SIZE):
    words = tuple(text.lower() for text, _, _ in tokens)
    return {words[index : index + size] for index in range(len(words) - size + 1)}


def near_duplicate_components(documents, tokenized, threshold=JACCARD_THRESHOLD):
    """Components of two or more documents linked by shingle Jaccard >= threshold."""
    shingle_sets = {
        document["id"]: shingles(tokenized[document["id"]]) for document in documents
    }
    postings = defaultdict(list)
    for document_id in sorted(shingle_sets):
        for shingle in shingle_sets[document_id]:
            postings[shingle].append(document_id)
    shared = Counter()
    for document_ids in postings.values():
        for left, right in combinations(document_ids, 2):
            shared[(left, right)] += 1
    union = Union(sorted(shingle_sets))
    for (left, right), count in shared.items():
        union_size = len(shingle_sets[left]) + len(shingle_sets[right]) - count
        if union_size and count / union_size >= threshold:
            union.union(left, right)
    return [group for group in _groups(union) if len(group) > 1]


def _select_function_words(documents, tokenized, limit=WRITER_FUNCTION_WORDS):
    counts = Counter()
    for document in documents:
        counts.update(
            text.lower()
            for text, _, _ in tokenized[document["id"]]
            if text.lower() in FUNCTION_WORDS
        )
    ranked = sorted(counts.items(), key=lambda pair: (-pair[1], pair[0]))
    return [word for word, _ in ranked[:limit]]


def writer_proxy_clusters(documents, tokenized, threshold=WRITER_THRESHOLD):
    """Cluster documents by inferred writing style, not by known author.

    Each document becomes a vector of relative frequencies over the 120 most
    frequent function words plus mean sentence length and mean token length.
    The length pair is rescaled to the frequency block's L2 norm so neither
    block dominates, then documents are joined by cosine similarity. Union-find
    is transitive, so the threshold is deliberately strict.
    """
    vocabulary = _select_function_words(documents, tokenized)
    allowed = set(vocabulary)
    profiles = {}
    for document in documents:
        document_id = document["id"]
        tokens = tokenized[document_id]
        words = [text.lower() for text, _, _ in tokens]
        counts = Counter(word for word in words if word in allowed)
        total = sum(counts.values())
        frequency = [
            counts.get(word, 0) / total if total else 0.0 for word in vocabulary
        ]
        mean_sentence = len(words) / max(1, len(sentences(tokens)))
        mean_token = sum(map(len, words)) / len(words) if words else 0.0
        frequency_norm = math.sqrt(math.fsum(value * value for value in frequency))
        length_norm = math.hypot(mean_sentence, mean_token)
        scale = frequency_norm / length_norm if frequency_norm and length_norm else 0.0
        profiles[document_id] = frequency + [mean_sentence * scale, mean_token * scale]

    identifiers = sorted(profiles)
    norms = {
        document_id: math.sqrt(
            math.fsum(value * value for value in profiles[document_id])
        )
        for document_id in identifiers
    }
    union = Union(identifiers)
    for index, left in enumerate(identifiers):
        for right in identifiers[index + 1 :]:
            if not norms[left] or not norms[right]:
                continue
            similarity = sum(map(operator.mul, profiles[left], profiles[right])) / (
                norms[left] * norms[right]
            )
            if similarity >= threshold:
                union.union(left, right)
    return _groups(union)


def assign_splits(clusters, seed=SEED, weights=SPLIT_WEIGHTS):
    """Assign whole clusters to splits, greedily filling the largest shortfall."""
    rng = random.Random(seed)
    order = [list(cluster) for cluster in clusters]
    rng.shuffle(order)
    total = sum(len(cluster) for cluster in order)
    targets = {split: total * weight for split, weight in weights.items()}
    counts = {split: 0 for split in weights}
    assignment = {}
    for cluster in order:
        split = max(
            SPLITS, key=lambda candidate: targets[candidate] - counts[candidate]
        )
        counts[split] += len(cluster)
        for document_id in cluster:
            assignment[document_id] = split
    return assignment


def recall_probe(documents, splits, tokenized, count=PROBE_SENTENCES, seed=SEED):
    """Deterministic 200-sentence probe from development, one round per document."""
    candidates = {}
    for document in documents:
        document_id = document["id"]
        if splits.get(document_id) != "development":
            continue
        tokens = tokenized[document_id]
        boundaries = sentences(tokens)
        if boundaries:
            candidates[document_id] = [
                (index, tokens[start][1], tokens[end - 1][2])
                for index, (start, end) in enumerate(boundaries)
            ]
    order = sorted(candidates)
    random.Random(seed).shuffle(order)
    cursor = {document_id: 0 for document_id in order}
    samples = []
    while len(samples) < count:
        advanced = False
        for document_id in order:
            if cursor[document_id] >= len(candidates[document_id]):
                continue
            index, start, end = candidates[document_id][cursor[document_id]]
            cursor[document_id] += 1
            samples.append(
                {
                    "documentId": document_id,
                    "sentenceIndex": index,
                    "start": start,
                    "end": end,
                }
            )
            advanced = True
            if len(samples) == count:
                break
        if not advanced:
            break
    samples.sort(key=lambda sample: (sample["documentId"], sample["sentenceIndex"]))
    return samples


def _annotation_counts(document):
    return len(document["annotations"]), sum(
        len(a["spans"]) for a in document["annotations"]
    )


def _write_json(path, payload):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
        newline="\n",
    )


def build(
    input_path=BENCHMARK_PATH,
    manifest_path=MANIFEST_PATH,
    report_path=REPORT_PATH,
    generated_at=None,
):
    """Build both manifests; returns the aggregate report payload."""
    raw = Path(input_path).read_bytes()
    dataset = json.loads(raw.decode("utf-8"))
    documents = dataset["documents"]
    input_counts = Counter(document["split"] for document in documents)
    tokenized = {document["id"]: tokenize(document["text"]) for document in documents}
    split_of = {document["id"]: document["split"] for document in documents}

    duplicates = near_duplicate_components(documents, tokenized)
    cross_split = [
        group for group in duplicates if len({split_of[i] for i in group}) > 1
    ]
    contaminated = {document_id for group in cross_split for document_id in group}
    kept = [document for document in documents if document["id"] not in contaminated]
    kept_tokenized = {document["id"]: tokenized[document["id"]] for document in kept}

    clusters = writer_proxy_clusters(kept, kept_tokenized)
    cluster_of = {
        document_id: index
        for index, cluster in enumerate(clusters)
        for document_id in cluster
    }
    assignment = assign_splits(clusters)

    v2_documents = defaultdict(list)
    tokens_per_split = Counter()
    records_per_split = Counter()
    spans_per_split = Counter()
    for document in kept:
        document_id = document["id"]
        split = assignment[document_id]
        records, span_count = _annotation_counts(document)
        tokens_per_split[split] += len(kept_tokenized[document_id])
        records_per_split[split] += records
        spans_per_split[split] += span_count
        v2_documents[split].append(
            {
                "id": document_id,
                "writerCluster": cluster_of[document_id],
                "tokens": len(kept_tokenized[document_id]),
                "annotationRecords": records,
                "annotationSpans": span_count,
                "spans": [
                    [start, end]
                    for annotation in document["annotations"]
                    for start, end in annotation["spans"]
                ],
            }
        )
    for entries in v2_documents.values():
        entries.sort(key=lambda entry: entry["id"])

    probe = recall_probe(kept, assignment, kept_tokenized)
    probe_documents = len({sample["documentId"] for sample in probe})
    source = {
        "benchmarkSha256": hashlib.sha256(raw).hexdigest(),
        "archiveSha256": dataset.get("archiveSha256"),
        "preparedDataSha256": dataset.get("preparedDataSha256"),
        "source": dataset.get("source"),
        "license": dataset.get("license"),
        "format": dataset.get("format"),
    }

    manifest = {
        "format": FORMAT,
        "source": source,
        "seed": SEED,
        "parameters": {
            "shingleSize": SHINGLE_SIZE,
            "jaccardThreshold": JACCARD_THRESHOLD,
            "writerFunctionWords": WRITER_FUNCTION_WORDS,
            "writerThreshold": WRITER_THRESHOLD,
            "probeSentences": PROBE_SENTENCES,
            "splitWeights": SPLIT_WEIGHTS,
        },
        "droppedDocuments": sorted(contaminated),
        "duplicateComponents": [
            {"documents": group, "crossSplit": group in cross_split}
            for group in duplicates
        ],
        "writerClusters": clusters,
        "documents": {split: v2_documents.get(split, []) for split in SPLITS},
        "recallProbe": {
            "split": "development",
            "count": len(probe),
            "documents": probe_documents,
            "samples": probe,
        },
    }

    dropped_counts = Counter(split_of[document_id] for document_id in contaminated)
    report = {
        "format": f"{FORMAT}-report",
        "generatedAt": generated_at or _now(),
        "source": {
            **source,
            "inputDocumentsPerSplit": {
                split: input_counts.get(split, 0) for split in SPLITS
            },
            "inputDocuments": len(documents),
        },
        "nearDuplicates": {
            "shingleSize": SHINGLE_SIZE,
            "jaccardThreshold": JACCARD_THRESHOLD,
            "components": len(duplicates),
            "crossSplitComponents": len(cross_split),
            "droppedDocuments": len(contaminated),
            "droppedPerSplit": {
                split: dropped_counts.get(split, 0) for split in SPLITS
            },
        },
        "writerProxy": {
            "threshold": WRITER_THRESHOLD,
            "clusters": len(clusters),
            "largestCluster": max((len(cluster) for cluster in clusters), default=0),
            "singletonClusters": sum(1 for cluster in clusters if len(cluster) == 1),
            "note": (
                "Proxy only: REALEC has no author ids, so clusters come from function-word "
                "frequencies plus mean sentence and token length."
            ),
        },
        "v2": {
            split: {
                "documents": len(v2_documents.get(split, [])),
                "tokens": tokens_per_split.get(split, 0),
                "annotationRecords": records_per_split.get(split, 0),
                "annotationSpans": spans_per_split.get(split, 0),
            }
            for split in SPLITS
        },
        "recallProbe": {"sentences": len(probe), "documents": probe_documents},
        "limitations": LIMITATIONS,
    }

    _write_json(manifest_path, manifest)
    _write_json(report_path, report)
    return report


def _now():
    from datetime import datetime

    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def summarize(report):
    """Short human-readable summary of an aggregate report."""
    source = report["source"]
    duplicates = report["nearDuplicates"]
    writer = report["writerProxy"]
    v2 = report["v2"]
    lines = [
        f"REALEC benchmark v2 ({source['benchmarkSha256'][:12]})",
        "input documents: "
        + ", ".join(
            f"{split} {source['inputDocumentsPerSplit'][split]}" for split in SPLITS
        ),
        (
            f"near-duplicates: {duplicates['components']} components, "
            f"{duplicates['crossSplitComponents']} cross-split, "
            f"{duplicates['droppedDocuments']} documents dropped"
        ),
        (
            f"writer proxy: {writer['clusters']} clusters "
            f"(largest {writer['largestCluster']}, singletons {writer['singletonClusters']}, "
            f"threshold {writer['threshold']})"
        ),
        "v2 split: "
        + "; ".join(
            f"{split} {v2[split]['documents']} docs / {v2[split]['tokens']} tokens / "
            f"{v2[split]['annotationSpans']} spans"
            for split in SPLITS
        ),
        (
            f"recall probe: {report['recallProbe']['sentences']} sentences from "
            f"{report['recallProbe']['documents']} development documents"
        ),
    ]
    return "\n".join(lines)


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Build or report the REALEC benchmark v2 split."
    )
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--build", action="store_true", help="write both manifests")
    action.add_argument("--report", action="store_true", help="print the saved summary")
    args = parser.parse_args(argv)

    if args.build:
        report = build()
        print(summarize(report))
        print(f"manifest: {MANIFEST_PATH}")
        print(f"report: {REPORT_PATH}")
        return 0

    if not REPORT_PATH.exists():
        parser.error(f"missing {REPORT_PATH}; run --build first")
    print(summarize(json.loads(REPORT_PATH.read_text(encoding="utf-8"))))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
