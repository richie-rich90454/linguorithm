"""Download only pinned dictionary blobs and verify the delivered provenance manifest."""

import base64
import hashlib
import json
import urllib.request

from train_release import ROOT


def main():
    manifest = json.loads(
        (ROOT / "training/datasets/dictionary-manifest.json").read_text(
            encoding="utf-8"
        )
    )
    directory = (ROOT / "training/datasets/raw/dictionary").resolve()
    directory.mkdir(parents=True, exist_ok=True)
    for record in manifest["files"]:
        target = (ROOT / record["path"]).resolve()
        if target.parent != directory:
            raise ValueError("Dictionary target escapes the dataset directory")
        if not target.exists():
            request = urllib.request.Request(
                f"https://api.github.com/repos/wooorm/dictionaries/git/blobs/{record['gitBlobSha']}",
                headers={"User-Agent": "Syntax-reproducible-training"},
            )
            with urllib.request.urlopen(request, timeout=60) as response:
                blob = json.load(response)
            data = base64.b64decode(blob["content"])
            if hashlib.sha256(data).hexdigest() != record["sha256"]:
                raise ValueError("Downloaded dictionary blob has an unexpected hash")
            target.write_bytes(data)
        if hashlib.sha256(target.read_bytes()).hexdigest() != record["sha256"]:
            raise ValueError(f"Pinned dictionary hash mismatch: {target.name}")
    print(
        json.dumps(
            {
                "verifiedFiles": len(manifest["files"]),
                "commit": manifest["repositoryCommit"],
            }
        )
    )


if __name__ == "__main__":
    main()
