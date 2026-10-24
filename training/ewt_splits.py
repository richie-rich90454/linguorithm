"""Read hash-verified official EWT splits with consistent leakage exclusions."""

import hashlib
import json


def verified_corpus_manifest(root):
    """Return pinned EWT provenance only after verifying all official source files."""
    directory = root / "training/datasets/raw/ewt"
    manifest = json.loads(
        (root / "training/datasets/ewt-manifest.json").read_text(encoding="utf-8")
    )
    hashes = {}
    for split in ["train", "dev", "test"]:
        name = f"en_ewt-ud-{split}.conllu"
        actual = hashlib.sha256((directory / name).read_bytes()).hexdigest()
        if actual != manifest["files"][name]["sha256"]:
            raise ValueError(f"Pinned EWT corpus hash mismatch: {name}")
        hashes[name] = actual
    return manifest, hashes


def verified_splits(root, read_corpus):
    """Verify every raw split before parsing, then exclude prior split overlap.

    Document groups remain intact within their official split. Exclusions only
    remove rows overlapping an earlier official split, matching syntax training.
    """
    directory = root / "training/datasets/raw/ewt"
    _, hashes = verified_corpus_manifest(root)
    seen, groups, splits, exclusions = set(), set(), {}, {}
    for split in ["train", "dev", "test"]:
        source = read_corpus(directory / f"en_ewt-ud-{split}.conllu")
        retained = [
            row
            for row in source
            if tuple(row["tokens"]) not in seen and row["group"] not in groups
        ]
        exclusions[split] = len(source) - len(retained)
        seen.update(tuple(row["tokens"]) for row in retained)
        groups.update(row["group"] for row in retained)
        splits[split] = retained
    return splits, {"corpusHashes": hashes, "splitExclusions": exclusions}
