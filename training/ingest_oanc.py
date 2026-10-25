"""Fetch the exact, project-local OANC GrAF archive used by ranker training."""

import hashlib
import json
import os
import re
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "training/datasets/oanc-manifest.json"
CHUNK_BYTES = 1024 * 1024
MAX_ATTEMPTS = 5
TRANSIENT_STATUSES = {408, 425, 429, 500, 502, 503, 504}


def read_manifest(path=MANIFEST):
    manifest = json.loads(path.read_text(encoding="utf-8"))
    if manifest.get("id") != "open-american-national-corpus-graf-2026-09-25":
        raise ValueError("Unexpected OANC release identity")
    if manifest.get("release") != "datasets-2026-09-25":
        raise ValueError("OANC release tag changed; review before accepting it")
    if not re.fullmatch(r"[0-9a-f]{64}", manifest.get("archiveSha256", "")):
        raise ValueError("OANC manifest requires a pinned archive SHA-256")
    if manifest.get("selectedCollections") != ["written_1", "written_2"]:
        raise ValueError("OANC written-only collection policy changed")
    if manifest.get("selectedDocuments") != 6424:
        raise ValueError("OANC selected-document count changed; review the archive")
    if not manifest.get("archiveUrl", "").startswith(
        "https://github.com/nancyide/anc-website/releases/download/datasets-2026-09-25/"
    ):
        raise ValueError(
            "OANC archive URL must point to the reviewed publisher release"
        )
    return manifest


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(CHUNK_BYTES), b""):
            digest.update(block)
    return digest.hexdigest()


def download_verified(
    url, expected_hash, expected_bytes, destination, opener=urlopen, wait=time.sleep
):
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(destination.name + ".download")
    if temporary.exists():
        temporary.unlink()
    request = Request(
        url,
        headers={
            "User-Agent": "Linguorithm-reproducible-training/1.0",
            "Accept": "application/octet-stream",
        },
    )
    last_error = None
    for attempt in range(MAX_ATTEMPTS):
        digest, size = hashlib.sha256(), 0
        try:
            with (
                opener(request, timeout=300) as response,
                temporary.open("wb") as target,
            ):
                while block := response.read(CHUNK_BYTES):
                    target.write(block)
                    digest.update(block)
                    size += len(block)
            actual_hash = digest.hexdigest()
            if size != expected_bytes:
                raise ValueError(
                    f"Pinned OANC archive size mismatch: expected {expected_bytes}, got {size}"
                )
            if actual_hash != expected_hash:
                raise ValueError(
                    f"Pinned OANC archive hash mismatch: expected {expected_hash}, got {actual_hash}"
                )
            os.replace(temporary, destination)
            return {"bytes": size, "sha256": actual_hash}
        except HTTPError as error:
            last_error = error
            if error.code not in TRANSIENT_STATUSES or attempt + 1 == MAX_ATTEMPTS:
                if error.code == 403:
                    raise RuntimeError(
                        "The official OANC release host denied the request; check network access."
                    ) from error
                raise RuntimeError(
                    f"Unable to download the pinned OANC archive (HTTP {error.code})"
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
                    f"Unable to download the pinned OANC archive after {MAX_ATTEMPTS} attempts: {error}"
                ) from error
            wait(min(30, 2**attempt))
        finally:
            if temporary.exists():
                temporary.unlink()
    raise RuntimeError(f"Unable to download the pinned OANC archive: {last_error}")


def ingest(root=ROOT, opener=urlopen, wait=time.sleep):
    manifest = read_manifest(root / "training/datasets/oanc-manifest.json")
    relative = Path(manifest["archivePath"])
    if relative.is_absolute() or ".." in relative.parts:
        raise ValueError("OANC archive path must remain inside the project")
    archive = root / relative
    if archive.is_file():
        actual_bytes = archive.stat().st_size
        actual_hash = sha256_file(archive)
        if (
            actual_bytes != manifest["archiveBytes"]
            or actual_hash != manifest["archiveSha256"]
        ):
            raise ValueError(
                "Existing project-local OANC archive does not match its pinned manifest"
            )
        return {
            "status": "verified-existing",
            "bytes": actual_bytes,
            "sha256": actual_hash,
        }
    result = download_verified(
        manifest["archiveUrl"],
        manifest["archiveSha256"],
        manifest["archiveBytes"],
        archive,
        opener=opener,
        wait=wait,
    )
    return {"status": "downloaded", **result}


if __name__ == "__main__":
    print(json.dumps(ingest(), ensure_ascii=False))
