"""Fetch a pinned official UD EWT release, preserving licenses and original splits."""

import base64
import hashlib
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "training/datasets/raw/ewt"
DEST.mkdir(parents=True, exist_ok=True)
RELEASE = "r2.16"
repo = "UniversalDependencies/UD_English-EWT"
request = urllib.request.Request(
    f"https://api.github.com/repos/{repo}/git/ref/tags/{RELEASE}",
    headers={"User-Agent": "Linguorithm-reproducible-training"},
)
ref = json.load(urllib.request.urlopen(request, timeout=60))["object"]
if ref["type"] == "tag":
    ref = json.load(
        urllib.request.urlopen(
            urllib.request.Request(
                f"https://api.github.com/repos/{repo}/git/tags/{ref['sha']}",
                headers={"User-Agent": "Linguorithm-reproducible-training"},
            ),
            timeout=60,
        )
    )["object"]
commit = ref["sha"]
if commit != "4c89b5833a70aa5ed3a00bad2f23f57992cc7df8":
    raise ValueError(
        "The upstream release reference changed; review before accepting a different corpus."
    )
manifest_path = ROOT / "training/datasets/ewt-manifest.json"
previous = (
    json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest_path.exists()
    else None
)
files = {}
for name in [
    "LICENSE.txt",
    "README.md",
    "en_ewt-ud-train.conllu",
    "en_ewt-ud-dev.conllu",
    "en_ewt-ud-test.conllu",
]:
    url = f"https://raw.githubusercontent.com/{repo}/{commit}/{name}"
    target = DEST / name
    if not target.exists():
        metadata = json.load(
            urllib.request.urlopen(
                urllib.request.Request(
                    f"https://api.github.com/repos/{repo}/contents/{name}?ref={commit}",
                    headers={"User-Agent": "Linguorithm-reproducible-training"},
                ),
                timeout=120,
            )
        )
        if metadata.get("encoding") == "base64":
            data = base64.b64decode(metadata["content"])
        else:
            blob = json.load(
                urllib.request.urlopen(
                    urllib.request.Request(
                        f"https://api.github.com/repos/{repo}/git/blobs/{metadata['sha']}",
                        headers={"User-Agent": "Linguorithm-reproducible-training"},
                    ),
                    timeout=120,
                )
            )
            data = base64.b64decode(blob["content"])
        target.write_bytes(data)
    files[name] = {
        "url": url,
        "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
    }
    if previous and previous["files"][name]["sha256"] != files[name]["sha256"]:
        raise ValueError(f"Pinned source hash mismatch: {name}")
manifest = {
    "id": "ud-english-ewt-2.16",
    "source": f"https://github.com/{repo}/tree/{commit}",
    "release": RELEASE,
    "commit": commit,
    "license": "CC-BY-SA-4.0",
    "permittedUse": "Use, redistribution and adaptation with attribution and share-alike conditions; original license retained",
    "attribution": "Universal Dependencies English Web Treebank contributors; see retained README and LICENSE",
    "files": files,
    "splitPolicy": "Official train/dev/test. Document IDs and exact sentences checked for leakage; author/prompt identities are not fully available.",
}
(ROOT / "training/datasets/ewt-manifest.json").write_text(
    json.dumps(manifest, indent=4) + "\n", encoding="utf-8"
)
print(json.dumps({"commit": commit, "files": len(files), "directory": str(DEST)}))
