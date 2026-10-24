# Isolated model development

All delivered assets, data, tooling, and caches reside inside this project. Frontend builds consume packaged artifacts and never train models or contact a corpus service.

```powershell
make train
make test-training
make check
make release
```

`make train` is the complete candidate pipeline. It ingests pinned data into the project, trains syntax models, prepares the classifier from frozen model predictions, checks exact Python/browser feature parity, trains the classifier, requires score parity against real browser ONNX inference, fits the contextual ranker, evaluates the oracle-feature reference, packages licensed resources, and evaluates quantization. It does not publish or replace the frozen release bundle. Review the candidate reports before promotion.

For an isolated classifier iteration after the syntax artifacts have been trained, run these steps in order:

```powershell
make prepare-errors ARGS="--workers 4"
make check-classifier-features
make train-errors
make check-classifier-features ARGS="--scores"
```

The feature check compares actual predicted POS tags, dependency heads, and numeric tensors from the browser runtime with the frozen Python preparation path. The score check compares the newly trained ONNX model against browser WASM inference and binds its report to that exact weight file. Training and packaging reject missing or stale evidence. Use the full `make train` pipeline when syntax weights or the lexicon have changed.

The delivered `.venv` uses `.tools/python`, has user-site disabled, and contains the dependencies pinned in `requirements.lock.txt`. Do not run global pip/npm installs. For an intentionally recreated environment, use a project-local Python runtime and `python -m venv .venv`, then install the lock with `./.venv/Scripts/python.exe -m pip install -r training/requirements.lock.txt` after setting project environment paths. Do not overwrite the supplied working environment unnecessarily.

The pinned EWT ingestion resolves official GitHub release r2.16 and verifies file hashes. Training, ranker fitting, and baseline evaluation recheck all three raw corpus hashes before parsing, retain full licensing and official document groups, and exclude exact sentence and document overlap across splits. Author and prompt identities are unavailable. The SCOWL-derived dictionary is supplied with its pinned upstream manifest and complete notices; packaging expands its PFX/SFX affixes.

The release trainer fits character CNN + bidirectional LSTM + CRF and an arc-standard transition MLP with bounded beam inference. Validation chooses the tagger checkpoint. Test data do not fit vocabulary, parameters, calibration, or thresholds. The error trainer derives agreement and perfect-form mutation labels from unique attested train-only paradigms; ambiguous and syncretic forms abstain. All classifier inputs come from the frozen predicted tagger/parser path. Platt calibration and threshold choice use separate validation document groups. Held-out component metrics are token-level controlled-task results before sentence caps and hybrid conflict handling. Neither those metrics nor the fixed-corpus production-worker probes establish accuracy on learner essays.

The contextual model uses a pruned interpolated Kneser–Ney bigram table and pairwise logistic correction ranking. The baseline script fits a sparse logistic classifier at a separately reported operating point. The quantization comparison evaluates actual float/int8 syntax models on the full held-out set; production remains float32 until browser parity and all relevant classifier gates are reviewed.

Output: `models/generated/ewt-1`; packaged browser assets: `apps/web/public/models`. Packaging preserves notices, generates and hashes a registry, checks declared syntax thresholds, and copies published ONNX Runtime WASM assets. Browser tests compare real emissions with Python fixtures and test failure/integrity/offline behavior. Run them after packaging and building.

Generic `train_tagger.py` and `calibrate.py` remain available for separately licensed JSONL datasets with explicit group splits. Do not ingest student writing without permission. BEA/FCE/LOCNESS resources have restrictions; [research notes](../docs/research-data-models.md) document the sources. Signing third-party agreements, human annotation, educator review, and learning trials require real authorized participants and are not fabricated by these scripts.

Measured results and caveats are in the [model card](../docs/model-card.md), `reports/ranker-evaluation.json`, `reports/classifier-baseline.json`, `reports/quantization-evaluation.json`, and model manifests. Preserve all corpus and dictionary notices in any distribution.

`make generalization` evaluates the production browser worker against the fixed 300-sentence EWT fixture, authored development probes, and controlled agreement mutations; it does not train weights. The fixture spans five official EWT source genres and remains within-corpus evidence. The current production path measures all-gold POS/UAS/LAS of 93.50%/81.91%/77.81%, hybrid target detection of 47/63 agreement mutations with 0/63 target false positives on source controls, and no classifier-only detections. No classifier category currently passes the emission gate. The browser fixture was inspected during tokenizer development, so refreshed scores are a reproducible regression measure rather than an untouched confirmatory estimate. See the [sampling, per-genre scores, and limitations](../docs/model-card.md#production-browser-generalization-check); synthetic coverage cannot replace independent learner-essay validation.
