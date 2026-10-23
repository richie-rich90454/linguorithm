"""Package licensed resources and evaluated artifacts into the static application's model directory."""

import hashlib
import json
import re
import shutil

from onnxruntime.quantization import QuantType, quantize_dynamic
from seal_manifests import main as seal_manifests
from train_release import ROOT, write_json

# Verify dictionary inputs again at packaging time: ingestion may have happened
# long before this release, and the packaged words must match their provenance.
dictionary_provenance = json.loads(
    (ROOT / "training/datasets/dictionary-manifest.json").read_text(encoding="utf-8")
)
dictionary_directory = (ROOT / "training/datasets/raw/dictionary").resolve()
for record in dictionary_provenance["files"]:
    target = (ROOT / record["path"]).resolve()
    if target.parent != dictionary_directory:
        raise ValueError("Dictionary target escapes the dataset directory")
    if hashlib.sha256(target.read_bytes()).hexdigest() != record["sha256"]:
        raise ValueError(f"Dictionary hash changed: {target.name}")

seal_manifests()
source = ROOT / "models/generated/ewt-1"
destination = ROOT / "apps/web/public/models"
weights = destination / "weights"
weights.mkdir(parents=True, exist_ok=True)
licenses = destination / "licenses"
licenses.mkdir(exist_ok=True)
shutil.copy2(ROOT / "models/licenses/onnxruntime-MIT.txt", licenses / "onnxruntime-MIT.txt")
tagger = json.loads((source / "tagger-manifest.json").read_text(encoding="utf-8"))
parser = json.loads((source / "parser-manifest.json").read_text(encoding="utf-8"))
if (
    tagger["evaluation"]["tagger"]["tokenAccuracy"] < 0.94
    or parser["evaluation"]["uas"] < 0.80
):
    raise ValueError(
        "Syntax models failed the declared minimum held-out accuracy thresholds."
    )
for model in ["tagger", "parser", "error-classifier"]:
    shutil.copy2(source / f"{model}.onnx", weights / f"{model}.onnx")
    quantized = source / f"{model}.int8.onnx"
    quantize_dynamic(
        str(source / f"{model}.onnx"),
        str(quantized),
        weight_type=QuantType.QInt8,
        op_types_to_quantize=["MatMul", "Gemm", "Gather"],
    )
    shutil.copy2(quantized, weights / quantized.name)
for name in [
    "tagger-manifest.json",
    "parser-manifest.json",
    "classifier-manifest.json",
    "lexicon.json",
    "contextual.json",
    "parity.json",
    "metrics.json",
]:
    shutil.copy2(source / name, destination / name)
shutil.copy2(
    ROOT / "training/datasets/raw/ewt/LICENSE.txt", licenses / "ewt-CC-BY-SA-4.0.txt"
)
shutil.copy2(
    ROOT / "training/datasets/raw/ewt/README.md", licenses / "ewt-attribution.md"
)
shutil.copy2(
    ROOT / "training/datasets/raw/dictionary/license",
    licenses / "dictionary-notices.txt",
)

affixes, cross = {}, {}
for line in (
    (ROOT / "training/datasets/raw/dictionary/index.aff")
    .read_text(encoding="utf-8")
    .splitlines()
):
    fields = line.split()
    if fields and fields[0] in {"PFX", "SFX"}:
        if len(fields) == 4:
            cross[fields[1]] = fields[2] == "Y"
        elif len(fields) >= 5:
            affixes.setdefault(fields[1], []).append(
                (
                    fields[0],
                    "" if fields[2] == "0" else fields[2],
                    "" if fields[3] == "0" else fields[3],
                    fields[4],
                )
            )


def apply(word, rules):
    output = set()
    for kind, strip, add, condition in rules:
        pattern = "^" + condition if kind == "PFX" else condition + "$"
        if not re.search(pattern, word):
            continue
        if kind == "PFX" and word.startswith(strip):
            output.add(add + word[len(strip) :])
        elif kind == "SFX" and (not strip or word.endswith(strip)):
            output.add((word[: -len(strip)] if strip else word) + add)
    return output


words = set()
for line in (
    (ROOT / "training/datasets/raw/dictionary/index.dic")
    .read_text(encoding="utf-8")
    .splitlines()[1:]
):
    stem, _, flags = line.partition("/")
    if "!" in flags or "c" in flags:
        continue
    forms = {stem}
    for flag in flags:
        forms.update(apply(stem, affixes.get(flag, [])))
    for flag in flags:
        if cross.get(flag) and any(r[0] == "PFX" for r in affixes.get(flag, [])):
            for prefixed in apply(stem, affixes.get(flag, [])):
                for other in flags:
                    if cross.get(other):
                        forms.update(
                            apply(
                                prefixed,
                                [r for r in affixes.get(other, []) if r[0] == "SFX"],
                            )
                        )
    words.update(form.lower() for form in forms if form.isalpha() or "'" in form)
write_json(
    destination / "dictionary.json",
    {
        "version": "scowl-en-US-60-expanded-1",
        "words": sorted(words),
        "provenance": dictionary_provenance,
        "modifications": "Expanded permitted PFX/SFX cross-products; excluded NOSUGGEST and ONLYINCOMPOUND entries; normalized lookup to lowercase",
    },
)


def resource(name):
    return {
        "path": name,
        "sha256": hashlib.sha256((destination / name).read_bytes()).hexdigest(),
    }


registry = {
    "schemaVersion": 2,
    "version": "ewt-1",
    "tagger": resource("tagger-manifest.json"),
    "parser": resource("parser-manifest.json"),
    "lexicon": resource("lexicon.json"),
    "contextual": resource("contextual.json"),
    "classifier": resource("classifier-manifest.json"),
    "dictionary": resource("dictionary.json"),
    "policy": "Syntax passed EWT accuracy and Python/ONNX parity gates. Grammar classifier calibrated on synthetic EWT mutations only; review-only until independent learner-essay validation.",
}
write_json(destination / "registry.json", registry)
write_json(
    ROOT / "models/manifests/registry.json",
    {
        **registry,
        "assetDirectory": "apps/web/public/models",
        "promotionPolicy": "Float syntax passed EWT/parity gates. Natural essay neural findings remain review-only. Int8 candidates require separate browser promotion checks.",
    },
)
runtime = ROOT / "apps/web/node_modules/onnxruntime-web/dist"
(destination / "runtime").mkdir(exist_ok=True)
for name in ["ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"]:
    shutil.copy2(runtime / name, destination / "runtime" / name)
write_json(
    ROOT / "reports/model-packaging.json",
    {
        "dictionaryForms": len(words),
        "resources": registry,
        "quantization": {
            name: {
                "floatBytes": (weights / f"{name}.onnx").stat().st_size,
                "int8Bytes": (weights / f"{name}.int8.onnx").stat().st_size,
                "production": "float32 until compressed-model browser/quality comparison passes",
            }
            for name in ["tagger", "parser", "error-classifier"]
        },
    },
)
print(
    json.dumps(
        {
            "event": "packaged",
            "dictionaryForms": len(words),
            "destination": str(destination),
        }
    )
)
