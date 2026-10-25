"""Fetch the hash-pinned spelling resources without GitHub's rate-limited API."""

import hashlib
import json
import re
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import urlopen

from ingest_ewt import download_verified
from train_release import ROOT

MANIFEST = "training/datasets/dictionary-manifest.json"
DATA_DIRECTORY = "training/datasets/raw/dictionary"
EXPECTED_FILES = {"index.dic", "index.aff", "license", "readme.md"}


def read_manifest(root=ROOT):
    """Validate identity, repository pin, paths, provenance, and file digests."""
    project_root = Path(root).resolve()
    manifest_path = (project_root / MANIFEST).resolve()
    if not manifest_path.is_relative_to(project_root):
        raise ValueError("Dictionary manifest escapes the project directory")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("schemaVersion") != 1 or manifest.get("id") != "scowl-en-US-60":
        raise ValueError("Unexpected dictionary manifest identity or schema")
    commit = manifest.get("repositoryCommit", "")
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("Dictionary manifest must pin a full repository commit")
    if not isinstance(manifest.get("files"), list):
        raise ValueError("Dictionary manifest files must be a list")
    names = set()
    for record in manifest["files"]:
        path = Path(record.get("path", ""))
        if path.parent.as_posix() != DATA_DIRECTORY or path.name not in EXPECTED_FILES:
            raise ValueError("Dictionary target escapes the reviewed data directory")
        name = path.name
        if name in names:
            raise ValueError(f"Duplicate dictionary manifest file: {name}")
        names.add(name)
        if not re.fullmatch(r"[0-9a-f]{64}", record.get("sha256", "")):
            raise ValueError(f"Invalid SHA-256 for dictionary file {name}")
        if not re.fullmatch(r"[0-9a-f]{40}", record.get("gitBlobSha", "")):
            raise ValueError(f"Invalid Git blob SHA for dictionary file {name}")
        if not isinstance(record.get("bytes"), int) or record["bytes"] <= 0:
            raise ValueError(f"Invalid byte count for dictionary file {name}")
        source = record.get("source", "")
        parsed = urlsplit(source)
        expected_path = f"/wooorm/dictionaries/blob/{commit}/dictionaries/en/{name}"
        if parsed.scheme != "https" or parsed.netloc != "github.com" or parsed.path != expected_path:
            raise ValueError(f"Unexpected pinned dictionary source URL for {name}")
    if names != EXPECTED_FILES:
        raise ValueError("Dictionary manifest file inventory differs from reviewed release")
    return manifest


def raw_url(record):
    """Translate a reviewed GitHub blob URL to its API-independent raw equivalent."""
    parts = urlsplit(record["source"])
    path = parts.path.split("/")
    if (
        parts.scheme != "https"
        or parts.netloc != "github.com"
        or len(path) != 8
        or path[1:3] != ["wooorm", "dictionaries"]
        or path[3] != "blob"
    ):
        raise ValueError("Unexpected dictionary provenance URL")
    commit = path[4]
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("Dictionary source URL is not pinned to an immutable commit")
    return (
        "https://raw.githubusercontent.com/wooorm/dictionaries/"
        f"{commit}/dictionaries/en/{path[-1]}"
    )


def ingest(root=ROOT, opener=urlopen, wait=None):
    """Verify existing project-local files or download immutable raw-file URLs."""
    project_root = Path(root).resolve()
    manifest = read_manifest(project_root)
    directory = (project_root / DATA_DIRECTORY).resolve()
    if not directory.is_relative_to(project_root):
        raise ValueError("Dictionary data directory escapes the project directory")
    directory.mkdir(parents=True, exist_ok=True)
    fetched, verified = [], []
    for record in manifest["files"]:
        target = (project_root / record["path"]).resolve()
        if target.parent != directory or not target.is_relative_to(project_root):
            raise ValueError("Dictionary target escapes the project-local data directory")
        if target.is_file():
            actual = hashlib.sha256(target.read_bytes()).hexdigest()
            if target.stat().st_size != record["bytes"] or actual != record["sha256"]:
                raise ValueError(f"Pinned dictionary hash or size mismatch: {target.name}")
            verified.append(target.name)
            continue
        kwargs = {"opener": opener}
        if wait is not None:
            kwargs["wait"] = wait
        size = download_verified(
            raw_url(record), record["sha256"], target, **kwargs
        )
        if size != record["bytes"]:
            target.unlink(missing_ok=True)
            raise ValueError(
                f"Pinned dictionary size mismatch for {target.name}: "
                f"expected {record['bytes']}, got {size}"
            )
        fetched.append(target.name)
    return {
        "commit": manifest["repositoryCommit"],
        "downloaded": len(fetched),
        "verifiedExisting": len(verified),
        "files": len(manifest["files"]),
        "directory": str(directory),
    }


if __name__ == "__main__":
    print(json.dumps(ingest(), ensure_ascii=False))
