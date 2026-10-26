"""Download a pinned REALEC archive and prepare document-separated local evaluation data."""

import hashlib
import json
import re
import tarfile
from pathlib import Path, PurePosixPath

from ingest_ewt import download_verified

ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "training/datasets/realec-manifest.json"


def read_manifest(path=MANIFEST_PATH):
    manifest = json.loads(path.read_text(encoding="utf-8"))
    if manifest.get("id") != "realec-manual-annotations-v1":
        raise ValueError("Unexpected REALEC identity; review the manifest first")
    if manifest.get("license") != "CC-BY-SA-4.0":
        raise ValueError("Unexpected REALEC license; review the manifest first")
    if not re.fullmatch(r"[0-9a-f]{64}", manifest.get("archiveSha256", "")):
        raise ValueError("Invalid REALEC archive SHA-256")
    if not re.fullmatch(r"[0-9a-f]{64}", manifest.get("preparedDataSha256", "")):
        raise ValueError("Invalid prepared REALEC data SHA-256")
    if manifest.get("source") != "https://rpractice.itorubarov.me/realec_download.tar.gz":
        raise ValueError("Unexpected REALEC source URL")
    return manifest


def count_annotation_records_and_spans(documents):
    """Count BRAT annotation records and their individual source ranges by split."""
    records = {name: 0 for name in ("train", "development", "test")}
    spans = {name: 0 for name in records}
    for document in documents:
        split = document["split"]
        for annotation in document["annotations"]:
            records[split] += 1
            spans[split] += len(annotation["spans"])
    return records, spans


def serialize_benchmark(benchmark):
    """Serialize with stable UTF-8 and LF bytes on every supported platform."""
    return (json.dumps(benchmark, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def write_verified_benchmark(path, benchmark, expected_digest):
    """Atomically replace a prepared cache only after its pinned digest matches."""
    benchmark_bytes = serialize_benchmark(benchmark)
    prepared_digest = sha256(benchmark_bytes)
    if prepared_digest != expected_digest:
        raise ValueError("Prepared REALEC data does not match its pinned SHA-256")
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".json.tmp")
    temporary.write_bytes(benchmark_bytes)
    temporary.replace(path)
    return prepared_digest


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def _utf16_slice(text, start, end):
    encoded = text.encode("utf-16-le")
    return encoded[start * 2 : end * 2].decode("utf-16-le")


def _to_utf16_offset(text, offset):
    return len(text[:offset].encode("utf-16-le")) // 2


def _ranges_match(text, ranges, surface, *, utf16=False):
    try:
        pieces = [
            _utf16_slice(text, start, end) if utf16 else text[start:end]
            for start, end in ranges
        ]
    except (UnicodeDecodeError, IndexError):
        return False
    return " ".join(pieces) == surface


def _find_unique_nearby_surface(text, start, surface, radius=3):
    if not surface:
        return None
    lower = max(0, start - radius)
    upper = min(len(text) - len(surface), start + radius)
    candidates = [
        offset
        for offset in range(lower, upper + 1)
        if text[offset : offset + len(surface)] == surface
    ]
    if not candidates:
        return None
    distance = min(abs(offset - start) for offset in candidates)
    nearest = [offset for offset in candidates if abs(offset - start) == distance]
    return nearest[0] if len(nearest) == 1 else None


def parse_annotations(text, annotation_text, document_id="unknown"):
    """Parse BRAT text-bound error annotations into validated UTF-16 source spans."""
    annotations = []
    for line_number, line in enumerate(annotation_text.splitlines(), start=1):
        if not re.match(r"^T\d+\t", line):
            continue
        fields = line.split("\t", 2)
        if len(fields) < 2:
            raise ValueError(f"Malformed text-bound annotation in {document_id}:{line_number}")
        label_and_ranges = fields[1].split(" ", 1)
        if len(label_and_ranges) != 2:
            raise ValueError(f"Malformed annotation ranges in {document_id}:{line_number}")
        label, encoded_ranges = label_and_ranges
        if label in {"note", "pos"} or label.startswith("pos_"):
            continue
        try:
            ranges = [
                tuple(map(int, segment.split(" ")))
                for segment in encoded_ranges.split(";")
            ]
        except (TypeError, ValueError) as error:
            raise ValueError(
                f"Invalid annotation offsets in {document_id}:{line_number}"
            ) from error
        if not ranges or any(start < 0 or end < start for start, end in ranges):
            raise ValueError(f"Out-of-range annotation in {document_id}:{line_number}")
        surface = fields[2].split("\t", 1)[0] if len(fields) == 3 else ""
        surface_verified = bool(surface)
        adjusted = False
        if not surface:
            utf16_length = len(text.encode("utf-16-le")) // 2
            if any(end > utf16_length for _, end in ranges):
                raise ValueError(
                    f"Annotation range exceeds its source in {document_id}:{line_number}"
                )
        elif _ranges_match(text, ranges, surface):
            ranges = [
                (_to_utf16_offset(text, start), _to_utf16_offset(text, end))
                for start, end in ranges
            ]
        elif _ranges_match(text, ranges, surface, utf16=True):
            pass
        elif len(ranges) == 1:
            corrected_start = _find_unique_nearby_surface(text, ranges[0][0], surface)
            if corrected_start is None:
                raise ValueError(
                    f"Annotation text does not match its source span in {document_id}:{line_number}"
                )
            ranges = [
                (
                    _to_utf16_offset(text, corrected_start),
                    _to_utf16_offset(text, corrected_start + len(surface)),
                )
            ]
            adjusted = True
        else:
            raise ValueError(
                f"Annotation text does not match its source span in {document_id}:{line_number}"
            )
        annotations.append(
            {
                "type": label,
                "spans": ranges,
                "surfaceVerified": surface_verified,
                "offsetAdjusted": adjusted,
            }
        )
    return annotations


def split_for_document(document_id, seed="linguorithm-realec-document-split-v1"):
    bucket = int(hashlib.sha256(f"{seed}:{document_id}".encode()).hexdigest()[:8], 16) % 100
    if bucket < 70:
        return "train"
    if bucket < 85:
        return "development"
    return "test"


def read_archive(archive_path, *, max_unpacked_bytes=64 * 1024 * 1024):
    """Read only top-level English essay pairs; never extract untrusted archive paths."""
    with tarfile.open(archive_path, mode="r:gz") as archive:
        members = archive.getmembers()
        if len(members) > 20_000 or sum(item.size for item in members) > max_unpacked_bytes:
            raise ValueError("REALEC archive exceeds its reviewed size limits")
        files = {}
        for item in members:
            path = PurePosixPath(item.name)
            if not item.isfile() or len(path.parts) != 1:
                continue
            match = re.fullmatch(r"(esl_\d+)\.(txt|ann)", path.name)
            if not match:
                continue
            key = (match.group(1), match.group(2))
            if key in files:
                raise ValueError(f"Duplicate REALEC archive member: {item.name}")
            files[key] = item

        text_ids = sorted({document_id for document_id, ext in files if ext == "txt"})
        if len(text_ids) < 100:
            raise ValueError("REALEC archive is missing its reviewed English essay collection")
        documents = []
        for document_id in text_ids:
            text_member = files[(document_id, "txt")]
            annotation_member = files.get((document_id, "ann"))
            if annotation_member is None:
                raise ValueError(f"Missing REALEC annotations for {document_id}")
            text = archive.extractfile(text_member).read().decode("utf-8")
            annotation_text = archive.extractfile(annotation_member).read().decode("utf-8")
            documents.append(
                {
                    "id": document_id,
                    "split": split_for_document(document_id),
                    "text": text,
                    "annotations": parse_annotations(text, annotation_text, document_id),
                }
            )
        return documents


def ingest(root=ROOT, *, opener=None):
    manifest = read_manifest()
    archive_path = root / manifest["cachePath"]
    benchmark_path = root / manifest["benchmarkPath"]
    if opener is None:
        download = download_verified(
            manifest["source"],
            manifest["archiveSha256"],
            archive_path,
        )
    else:
        download = download_verified(
            manifest["source"],
            manifest["archiveSha256"],
            archive_path,
            opener=opener,
            wait=lambda _: None,
        )
    archive = archive_path.read_bytes()
    if sha256(archive) != manifest["archiveSha256"]:
        raise ValueError("Cached REALEC archive does not match its pinned SHA-256")
    documents = read_archive(archive_path)
    counts = {name: 0 for name in ("train", "development", "test")}
    annotations = [annotation for document in documents for annotation in document["annotations"]]
    annotation_audit = {
        "totalErrorAnnotations": len(annotations),
        "surfaceVerified": sum(annotation["surfaceVerified"] for annotation in annotations),
        "rangeOnly": sum(not annotation["surfaceVerified"] for annotation in annotations),
        "offsetAdjusted": sum(annotation["offsetAdjusted"] for annotation in annotations),
    }
    for document in documents:
        counts[document["split"]] += 1
    benchmark = {
        "format": "linguorithm-realec-local-benchmark-v1",
        "source": manifest["source"],
        "sourcePage": manifest["sourcePage"],
        "archiveSha256": manifest["archiveSha256"],
        "license": manifest["license"],
        "attribution": manifest["attribution"],
        "purpose": manifest["purpose"],
        "splitPolicy": manifest["documentSplit"],
        "authorIdentityAvailable": False,
        "annotationAudit": annotation_audit,
        "documents": documents,
    }
    annotation_records, error_spans = count_annotation_records_and_spans(documents)
    prepared_digest = write_verified_benchmark(
        benchmark_path, benchmark, manifest["preparedDataSha256"]
    )
    return {
        "archiveBytes": len(archive),
        "archiveSha256": manifest["archiveSha256"],
        "downloadedBytes": download,
        "documents": len(documents),
        "documentsBySplit": counts,
        "errorAnnotationsBySplit": annotation_records,
        "errorSpansBySplit": error_spans,
        "preparedDataSha256": prepared_digest,
        "annotationAudit": annotation_audit,
        "benchmarkPath": str(benchmark_path),
    }


if __name__ == "__main__":
    print(json.dumps(ingest(), indent=2))
