"""Fetch hash-pinned UD EWT files without GitHub's rate-limited API."""

import hashlib
import json
import os
import re
import time
from datetime import timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "training/datasets/ewt-manifest.json"
DEST = ROOT / "training/datasets/raw/ewt"
MAX_ATTEMPTS = 5
TRANSIENT_STATUSES = {408, 425, 429, 500, 502, 503, 504}
MAX_RETRY_DELAY_SECONDS = 3600


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def retry_delay(error, attempt, now=None):
    """Return a bounded retry delay, including explicit GitHub rate-limit 403s."""
    headers = error.headers or {}
    rate_limited = (
        str(headers.get("X-RateLimit-Remaining", "")).strip() == "0"
        or "Retry-After" in headers
    )
    if error.code not in TRANSIENT_STATUSES and not (
        error.code == 403 and rate_limited
    ):
        return None

    now = time.time() if now is None else now
    retry_after = headers.get("Retry-After")
    if retry_after:
        try:
            return min(MAX_RETRY_DELAY_SECONDS, max(0, int(retry_after)))
        except ValueError:
            try:
                retry_at = parsedate_to_datetime(retry_after)
                if retry_at.tzinfo is None:
                    retry_at = retry_at.replace(tzinfo=timezone.utc)
                return min(
                    MAX_RETRY_DELAY_SECONDS,
                    max(0, int(retry_at.timestamp() - now)),
                )
            except (TypeError, ValueError, OverflowError):
                pass

    reset_at = headers.get("X-RateLimit-Reset")
    if error.code == 403 and reset_at:
        try:
            return min(
                MAX_RETRY_DELAY_SECONDS,
                max(0, int(float(reset_at) - now)),
            )
        except (TypeError, ValueError, OverflowError):
            pass
    return min(30, 2**attempt)


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
            delay = retry_delay(error, attempt)
            if delay is None or attempt + 1 == MAX_ATTEMPTS:
                if error.code == 403 and delay is None:
                    raise RuntimeError(
                        "The pinned raw-file host denied this request. EWT ingestion "
                        "does not use the GitHub API; check network access or use the "
                        "verified local corpus files."
                    ) from error
                raise RuntimeError(
                    f"Unable to download pinned EWT file {destination.name} "
                    f"(HTTP {error.code})"
                ) from error
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
    project_root = Path(root).resolve()
    manifest_path = (project_root / "training/datasets/ewt-manifest.json").resolve()
    if not manifest_path.is_relative_to(project_root):
        raise ValueError("EWT manifest escapes the project directory")
    manifest = read_manifest(manifest_path)
    destination = (project_root / "training/datasets/raw/ewt").resolve()
    if not destination.is_relative_to(project_root):
        raise ValueError("EWT data directory escapes the project directory")
    destination.mkdir(parents=True, exist_ok=True)
    fetched, verified = [], []
    for name, entry in manifest["files"].items():
        target = (destination / name).resolve()
        if target.parent != destination or not target.is_relative_to(project_root):
            raise ValueError(f"EWT target escapes the project-local data directory: {name}")
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
