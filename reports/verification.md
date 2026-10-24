# Development verification

Environment: Windows x64, project-local Node 24.19.0 / pnpm 12.14.0 / Python 3.12.14; local Python environment and browser binaries.

- 189 engine unit/property/regression tests pass.
- 156 browser checks passed across Chromium, Firefox, WebKit, and mobile Chromium emulation, including model integrity/offline loading, database migration, bounded archive expansion, PPTX/XLSX import, and review regression checks. Includes cross-browser cache/retry/restore reliability coverage and laptop viewport checks.
- Actual Python/ONNX emissions agree within 0.0002 in all four browser configurations.
- 18 authored MCQs plus 88 controlled mutation repairs validate, including exact restoration of the target sentence and unique answer keys.
- Oxlint, exact Oxfmt configuration, strict TypeScript, production build, and Python Ruff checks pass.
- Full held-out syntax evaluation: 1,962 sentences / 24,859 tokens. POS 94.47%; parser UAS 81.66%, LAS 77.27%. Full float/int8 comparison and size measurements are saved.
- Separately, the 2026-10-24 production-browser report in [generalization.json](generalization.json) measures 300 held-out EWT sentences / 3,659 gold tokens across five source genres. All-gold POS/UAS/LAS are 92.18%/80.16%/76.09%; unmatched/fallback tokens count as incorrect. Exact sentence tokenization matches on 229/300 sentences; 3,561/3,659 gold tokens align to neural spans. Per-genre results and the sampling method are documented in the [model card](../docs/model-card.md#production-browser-generalization-check). This remains within-corpus evidence, not independent learner-essay validation.
- The same report records no active classifier category: classifier-only emitted findings detect 0/63 controlled agreement mutations; the complete hybrid detects 47/63 and misses 16/63. Both have zero target-token false positives on 63 source controls. On 26 authored clean probes, conservative false positives are zero and one case has a review warning. These small controlled/development sets cannot establish natural-error precision or recall. All 411 evaluated cases pass source/edit integrity checks over 151 proposals; the report binds evidence to served resource and worker hashes without changing weights.
- Correction ranker: 769 controlled held-out examples, 81.53% top-1; synthetic-task scope is explicit.
- Initial entry JavaScript is approximately 104 KiB gzip against a 250 KiB budget. This excludes deferred worker/import/model/WASM assets.
- Model manifests record provenance, SHA-256, split limitations, actual training environment, metrics, calibration scope, and unavailable categories.
- Code review identified and fixed assessment navigation, pre-answer source disclosure, unavailable material references, and active-state refresh after backup restore.

The interface inspection script writes current screenshots and axe/privacy/overflow results. The regression evaluation contains Wilson 95% category intervals, explicitly marked as development evidence. Performance reports distinguish Node, browser, sampled memory, and device emulation.

Independent learner-error accuracy, educator approval, competitor comparisons, and student learning effects remain unestablished. See ../docs/release-status.md and ../docs/model-card.md for scope.
