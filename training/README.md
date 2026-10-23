# Isolated model development

All delivered assets, data, tooling, and caches reside inside this project. Frontend builds consume packaged artifacts and never train models or contact a corpus service.

```powershell
. ./scripts/project-env.ps1
./.venv/Scripts/python.exe training/ingest_ewt.py
./.venv/Scripts/python.exe training/train_release.py --epochs 12 --parser-epochs 6
./.venv/Scripts/python.exe training/train_errors.py
./.venv/Scripts/python.exe training/train_ranker.py
./.venv/Scripts/python.exe training/evaluate_baseline.py
./.venv/Scripts/python.exe training/package_models.py
./.venv/Scripts/python.exe training/evaluate_quantization.py
./.venv/Scripts/python.exe -m ruff check training
./.venv/Scripts/python.exe -m ruff format --check training
```

The delivered `.venv` uses `.tools/python`, has user-site disabled, and contains the dependencies pinned in `requirements.lock.txt`. Do not run global pip/npm installs. For an intentionally recreated environment, use a project-local Python runtime and `python -m venv .venv`, then install the lock with `./.venv/Scripts/python.exe -m pip install -r training/requirements.lock.txt` after setting project environment paths. Do not overwrite the supplied working environment unnecessarily.

The pinned EWT ingestion resolves official GitHub release r2.16 and verifies file hashes. It retains full licensing and original document splits. Exact duplicate sentences are removed across splits. Author and prompt identities are unavailable. The SCOWL-derived dictionary is already supplied with its pinned upstream manifest and complete notices; packaging expands its PFX/SFX affixes.

The release trainer fits character CNN + bidirectional LSTM + CRF and an arc-standard transition MLP with bounded beam inference. Validation chooses the tagger checkpoint. Test data do not fit vocabulary, parameters, calibration, or thresholds. The error trainer uses verified controlled mutations, fits Platt scaling on one validation half, selects thresholds on the other, and reports untouched test results by category. These synthetic-task results do not establish learner-essay calibration.

The contextual model uses a pruned interpolated Kneser–Ney bigram table and pairwise logistic correction ranking. The baseline script fits a sparse logistic classifier at a separately reported operating point. The quantization comparison evaluates actual float/int8 syntax models on the full held-out set; production remains float32 until browser parity and all relevant classifier gates are reviewed.

Output: `models/generated/ewt-1`; packaged browser assets: `apps/web/public/models`. Packaging preserves notices, generates and hashes a registry, checks declared syntax thresholds, and copies published ONNX Runtime WASM assets. Browser tests compare real emissions with Python fixtures and test failure/integrity/offline behavior. Run them after packaging and building.

Generic `train_tagger.py` and `calibrate.py` remain available for separately licensed JSONL datasets with explicit group splits. Do not ingest student writing without permission. BEA/FCE/LOCNESS resources have restrictions; [research notes](../docs/research-data-models.md) document the sources. Signing third-party agreements, human annotation, educator review, and learning trials require real authorized participants and are not fabricated by these scripts.

Measured results and caveats are in the [model card](../docs/model-card.md), `reports/ranker-evaluation.json`, `reports/classifier-baseline.json`, `reports/quantization-evaluation.json`, and model manifests. Preserve all corpus and dictionary notices in any distribution.
