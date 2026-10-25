"""Copy reproducible neural checkpoints into the versioned project area."""

import hashlib
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHECKPOINTS = ROOT / "models/checkpoints/ewt-1"
MANIFEST = CHECKPOINTS / "manifest.json"


def record_checkpoint(name, generated_path, metadata):
    if Path(name).name != name or not name.endswith(".pt"):
        raise ValueError("Checkpoint name must be a plain .pt filename")
    generated_path = Path(generated_path).resolve()
    try:
        generated_path.relative_to((ROOT / "models/generated/ewt-1").resolve())
    except ValueError as error:
        raise ValueError(
            "Generated checkpoint must remain under models/generated/ewt-1"
        ) from error
    CHECKPOINTS.mkdir(parents=True, exist_ok=True)
    target = CHECKPOINTS / name
    shutil.copy2(generated_path, target)
    artifact = {
        "path": name,
        "bytes": target.stat().st_size,
        "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
        **metadata,
    }
    manifest = (
        json.loads(MANIFEST.read_text(encoding="utf-8"))
        if MANIFEST.exists()
        else {"schemaVersion": 1, "version": "ewt-1", "checkpoints": {}}
    )
    manifest["checkpoints"][name] = artifact
    MANIFEST.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=4) + "\n", encoding="utf-8"
    )
