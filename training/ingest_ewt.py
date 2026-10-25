"""Fetch hash-pinned UD EWT files without GitHub's rate-limited API."""

import hashlib
import json
import os
import re
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "training/datasets/ewt-manifest.json"
DEST = ROOT / "training/datasets/raw/ewt"
MAX_ATTEMPTS = 5
TRANSIENT_STATUSES = {408, 425, 429, 500, 502, 503, 504}


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def read_manifest(path=MANIFEST):
    manifest = json.loads(path.read_text(encoding="utf-8"))
    commit = manifest.get("commit", "")
    source = manifest.get("source", "")
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("EWT manifest must pin a full 40-character commit SHA")
    if not source.endswith("/" + commit):
        raise ValueError("EWT source URL must identify the pinned commit")
    if manifest.get("id") != "ud-english-ewt-2.16":
        raise ValueError("Unexpected EWT dataset identity; review the manifest first")
    if manifest.get("release") != "r2.16":
        raise ValueError("Unexpected EWT release; review the manifest first")
    required = {
        "LICENSE.txt",
        "README.md",
        "en_ewt-ud-train.conllu",
        "en_ewt-ud-dev.conllu",
        "en_ewt-ud-test.conllu",
    }
    if set(manifest.get("files", {})) != required:
        raise ValueError(
            "EWT manifest file inventory differs from the reviewed release"
        )
    for name, entry in manifest["files"].items():
        expected_url = (
            "https://raw.githubusercontent.com/UniversalDependencies/UD_English-EWT/"
            f"{commit}/{name}"
        )
        if entry.get("url") != expected_url:
            raise ValueError(f"Unexpected pinned source URL for {name}")
        if not re.fullmatch(r"[0-9a-f]{64}", entry.get("sha256", "")):
            raise ValueError(f"Invalid SHA-256 for {name}")
    return manifest


def download_verified(url, expected_hash, destination, opener=urlopen, wait=time.sleep):
    """Download one immutable raw file and replace it only after hash validation."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(destination.name + ".download")
    request = Request(
        url,
        headers={
            "User-Agent": "Linguorithm-reproducible-training/1.0",
            "Accept": "application/octet-stream",
        },
    )
    last_error = None
    for attempt in range(MAX_ATTEMPTS):
        try:
            with opener(request, timeout=120) as response:
                data = response.read()
            actual_hash = sha256(data)
            if actual_hash != expected_hash:
                raise ValueError(
                    f"Pinned source hash mismatch for {destination.name}: "
                    f"expected {expected_hash}, got {actual_hash}"
                )
            temporary.write_bytes(data)
            os.replace(temporary, destination)
            return len(data)
        except HTTPError as error:
            last_error = error
            if error.code not in TRANSIENT_STATUSES or attempt + 1 == MAX_ATTEMPTS:
                if error.code == 403:
                    raise RuntimeError(
                        "The pinned raw-file host denied this request. EWT ingestion "
                        "does not use the GitHub API; check network access or use the "
                        "verified local corpus files."
                    ) from error
                raise RuntimeError(
                    f"Unable to download pinned EWT file {destination.name} "
                    f"(HTTP {error.code})"
                ) from error
            retry_after = error.headers.get("Retry-After") if error.headers else None
            delay = (
                min(30, int(retry_after))
                if retry_after and retry_after.isdigit()
                else 2**attempt
            )
            wait(delay)
        except (TimeoutError, URLError, ConnectionError, OSError) as error:
            last_error = error
            if attempt + 1 == MAX_ATTEMPTS:
                raise RuntimeError(
                    f"Unable to download pinned EWT file {destination.name} after "
                    f"{MAX_ATTEMPTS} attempts: {error}"
                ) from error
            wait(min(30, 2**attempt))
        finally:
            if temporary.exists():
                temporary.unlink()
    raise RuntimeError(f"Unable to download pinned EWT file: {last_error}")


def ingest(root=ROOT, opener=urlopen, wait=time.sleep):
    manifest = read_manifest(root / "training/datasets/ewt-manifest.json")
    destination = root / "training/datasets/raw/ewt"
    destination.mkdir(parents=True, exist_ok=True)
    fetched, verified = [], []
    for name, entry in manifest["files"].items():
        target = destination / name
        if target.is_file():
            actual = sha256(target.read_bytes())
            if actual == entry["sha256"]:
                verified.append(name)
                continue
            raise ValueError(
                f"Existing pinned EWT file is modified: {name}. "
                "Move it aside and rerun ingestion to fetch the reviewed bytes."
            )
        download_verified(entry["url"], entry["sha256"], target, opener, wait)
        fetched.append(name)
    return {
        "commit": manifest["commit"],
        "verifiedExisting": len(verified),
        "downloaded": len(fetched),
        "files": len(manifest["files"]),
        "directory": str(destination),
    }


if __name__ == "__main__":
    print(json.dumps(ingest(), ensure_ascii=False))
