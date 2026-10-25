"""Pinned supplementary UD English sources for syntax training and evaluation."""

import hashlib
import json
import re
from pathlib import Path

from ingest_ewt import download_verified

MANIFEST_NAME = "training/datasets/ud-english-manifest.json"
DATA_ROOT = "training/datasets/raw/ud-english"
ALLOWED_LICENSES = {"CC-BY-SA-3.0", "CC-BY-SA-4.0"}


def read_manifest(root):
    manifest = json.loads((root / MANIFEST_NAME).read_text(encoding="utf-8"))
    if manifest.get("schemaVersion") != 1:
        raise ValueError("Unsupported supplementary UD manifest schema")
    sources = manifest.get("sources")
    if not isinstance(sources, list) or not sources:
        raise ValueError("Supplementary UD manifest has no sources")
    ids = set()
    for source in sources:
        source_id = source.get("id", "")
        if not re.fullmatch(r"ud-en-[a-z0-9-]+-r2\.18", source_id):
            raise ValueError(f"Invalid supplementary UD source id: {source_id}")
        if source_id in ids:
            raise ValueError(f"Duplicate supplementary UD source id: {source_id}")
        ids.add(source_id)
        if source.get("license") not in ALLOWED_LICENSES:
            raise ValueError(
                f"Source {source_id} is outside the reviewed redistribution policy"
            )
        commit = source.get("commit", "")
        repository = source.get("repository", "")
        if not re.fullmatch(r"[0-9a-f]{40}", commit):
            raise ValueError(f"Source {source_id} is not pinned to a full commit")
        if not repository.startswith(
            "https://github.com/UniversalDependencies/UD_English-"
        ):
            raise ValueError(f"Unexpected upstream repository for {source_id}")
        files = source.get("files", {})
        if not {"README.md", "LICENSE.txt"}.issubset(files):
            raise ValueError(f"Source {source_id} is missing license attribution files")
        for name, metadata in files.items():
            if Path(name).name != name or not re.fullmatch(
                r"[0-9a-f]{64}", metadata.get("sha256", "")
            ):
                raise ValueError(f"Invalid pinned file record for {source_id}/{name}")
            if not name.endswith(".conllu") and name not in {
                "README.md",
                "LICENSE.txt",
            }:
                raise ValueError(f"Unexpected file type for {source_id}/{name}")
        splits = source.get("splits", {})
        if not splits or any(name not in files for name in splits.values()):
            raise ValueError(f"Source {source_id} references an unpinned split")
        if source.get("use") == "syntax-training-and-held-out-evaluation":
            if "train" not in splits or "test" not in splits:
                raise ValueError(
                    f"Training source {source_id} requires train and test splits"
                )
        elif source.get("use") == "held-out-evaluation-only":
            if "train" in splits or "test" not in splits:
                raise ValueError(
                    f"Evaluation-only source {source_id} must remain held out"
                )
        else:
            raise ValueError(f"Unknown use policy for {source_id}")
    return manifest


def ingest(root, opener=None, wait=None):
    """Verify or fetch the exact manifest bytes from pinned raw GitHub URLs."""
    manifest = read_manifest(root)
    fetched, verified = [], []
    for source in manifest["sources"]:
        directory = root / DATA_ROOT / source["id"]
        directory.mkdir(parents=True, exist_ok=True)
        repository = source["repository"].removeprefix("https://github.com/")
        for name, metadata in source["files"].items():
            target = directory / name
            expected = metadata["sha256"]
            if target.is_file():
                actual = hashlib.sha256(target.read_bytes()).hexdigest()
                if actual != expected:
                    raise ValueError(
                        f"Modified pinned UD source file: {source['id']}/{name}"
                    )
                verified.append(f"{source['id']}/{name}")
                continue
            url = (
                "https://raw.githubusercontent.com/"
                f"{repository}/{source['commit']}/{name}"
            )
            kwargs = {}
            if opener is not None:
                kwargs["opener"] = opener
            if wait is not None:
                kwargs["wait"] = wait
            download_verified(url, expected, target, **kwargs)
            fetched.append(f"{source['id']}/{name}")
    return {
        "sources": len(manifest["sources"]),
        "trainingSources": sum(
            "train" in source["splits"] for source in manifest["sources"]
        ),
        "heldOutSources": sum(
            "test" in source["splits"] for source in manifest["sources"]
        ),
        "verifiedExistingFiles": len(verified),
        "downloadedFiles": len(fetched),
    }


def load_training_rows(root, read_corpus):
    """Return only official train splits, with globally unique source groups."""
    manifest = read_manifest(root)
    rows, counts, hashes = [], {}, {}
    seen = set()
    for source in manifest["sources"]:
        filename = source["splits"].get("train")
        if filename is None:
            continue
        path = root / DATA_ROOT / source["id"] / filename
        expected_hash = source["files"][filename]["sha256"]
        actual_hash = hashlib.sha256(path.read_bytes()).hexdigest()
        if actual_hash != expected_hash:
            raise ValueError(
                f"Pinned UD source hash mismatch: {source['id']}/{filename}"
            )
        source_rows = read_corpus(path)
        retained = []
        for row in source_rows:
            sentence = tuple(row["tokens"])
            if sentence in seen:
                continue
            seen.add(sentence)
            row["sourceId"] = source["id"]
            row["id"] = f"{source['id']}:{row['id']}"
            row["group"] = f"{source['id']}:{row['group']}"
            retained.append(row)
        rows.extend(retained)
        counts[source["id"]] = {
            "sentences": len(retained),
            "sourceSentences": len(source_rows),
            "tokens": sum(len(row["tokens"]) for row in retained),
            "license": source["license"],
        }
        hashes[f"{source['id']}/{filename}"] = actual_hash
    return rows, {"sources": counts, "corpusHashes": hashes}


def load_evaluation_rows(root, read_corpus):
    """Load official test splits only; evaluation-only sets can never enter training."""
    manifest = read_manifest(root)
    result = {}
    for source in manifest["sources"]:
        filename = source["splits"].get("test")
        if filename is None:
            continue
        path = root / DATA_ROOT / source["id"] / filename
        expected_hash = source["files"][filename]["sha256"]
        actual_hash = hashlib.sha256(path.read_bytes()).hexdigest()
        if actual_hash != expected_hash:
            raise ValueError(
                f"Pinned UD evaluation hash mismatch: {source['id']}/{filename}"
            )
        rows = read_corpus(path)
        for row in rows:
            row["sourceId"] = source["id"]
            row["id"] = f"{source['id']}:{row['id']}"
            row["group"] = f"{source['id']}:{row['group']}"
        result[source["id"]] = {
            "rows": rows,
            "license": source["license"],
            "domain": source["domain"],
            "sha256": actual_hash,
        }
    return result


if __name__ == "__main__":
    print(json.dumps(ingest(Path(__file__).resolve().parents[1])))
