# Development verification

Environment: Windows x64, project-local Node 24.19.0 / pnpm 12.14.0 / Python 3.12.14; local Python environment and browser binaries.

- 148 engine unit/property/regression tests pass.
- 136 browser checks passed across Chromium, Firefox, WebKit, and mobile Chromium emulation, including model integrity/offline loading, database migration, bounded archive expansion, PPTX/XLSX import, and review regression checks. Includes 20 new cache/retry/restore reliability cases and eight laptop viewport checks. Four assertions referencing the removed promotional workbench heading were updated to the current page heading and passed on rerun.
- Actual Python/ONNX emissions agree within 0.0002 in all four browser configurations.
- 18 authored MCQs plus 88 controlled mutation repairs validate, including exact restoration of the target sentence and unique answer keys.
- Oxlint, exact Oxfmt configuration, strict TypeScript, production build, and Python Ruff checks pass.
- Full held-out syntax evaluation: 1,962 sentences / 24,859 tokens. POS 94.47%; parser UAS 81.66%, LAS 77.27%. Full float/int8 comparison and size measurements are saved.
- Correction ranker: 769 controlled held-out examples, 81.53% top-1; synthetic-task scope is explicit.
- Initial entry JavaScript is approximately 104 KiB gzip against a 250 KiB budget. This excludes deferred worker/import/model/WASM assets.
- Model manifests record provenance, SHA-256, split limitations, actual training environment, metrics, calibration scope, and unavailable categories.
- Code review identified and fixed assessment navigation, pre-answer source disclosure, unavailable material references, and active-state refresh after backup restore.

The interface inspection script writes current screenshots and axe/privacy/overflow results. The regression evaluation contains Wilson 95% category intervals, explicitly marked as development evidence. Performance reports distinguish Node, browser, sampled memory, and device emulation.

Independent learner-error accuracy, educator approval, competitor comparisons, and student learning effects remain unestablished. See ../docs/release-status.md and ../docs/model-card.md for scope.
