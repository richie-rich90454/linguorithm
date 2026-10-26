# Development verification

Latest completed release run: 2026-10-26, Windows x64. GNU Make invokes the project-contained Node runtime; Python, dependencies, model assets, caches, and browser binaries remain inside the project.

- `make release` passed formatting, lint, strict TypeScript checks, and 324 engine tests across 21 files. `make test-training` passed 46 Python tests.
- The serial Playwright suite passed all 196 checks across Chromium, Firefox, WebKit, and mobile Chromium emulation. This includes local-model parity, offline reload, import security, persistence and restore, keyboard access, responsive layouts, and grammar review flows.
- Content validation passed for 106 authored and verified-mutation exercises. Model release checks verified all 18 resources, repaired a damaged asset, and rejected a corrupt archive.
- The production build passed. Initial JavaScript measured 84.5 KiB gzip against the 104.7 KiB budget; secondary views and the analysis worker are lazy-loaded. Runtime inference and document analysis remain local.
- The frozen full-EWT production checkpoint remains at 94.47% POS, 81.66% UAS, and 77.27% LAS across 1,962 sentences and 24,859 tokens. The expanded-training candidate scored 94.66%/82.41%/77.97% on that split, gains of 0.19/0.75/0.70 points. It was not promoted: its fixed browser candidate regressed POS and LAS against production, and its quoted-speech source/edit-integrity case failed.
- The current production browser-path regression scored 93.50% POS, 81.91% UAS, and 77.81% LAS across 300 EWT sentences and 3,659 gold tokens; 3,610 tokens aligned and 266 sentences tokenized exactly. These are within-corpus regression scores, not independent learner-writing estimates, and remain short of the requested five-point gains.
- The production hybrid detected 53 of 63 controlled agreement mutations, with 0 target false positives on 63 source controls; classifier-only emissions detected 0. All 411 production analysis cases passed source/edit-integrity checks across 229 proposals. Authored probes remain development fixtures, not independent validation.
- All 100 writing goals have registered local analysis associations: 32 narrow diagnostic mappings, 67 optional evidence cues, and one goal with both. No goal detector has independent evidence meeting the requested precision, recall, valid-control, and correction-acceptability gates. A million independently held-out tokens for the 99.9999% POS goal are also unavailable.

Detailed methods, per-genre scores, candidate failures, and evidence limits are in the [model card](../docs/model-card.md), [detector coverage](../docs/detector-coverage.md), and [generalization report](generalization.json). Passing software checks do not satisfy the unmet model and pattern-quality thresholds.
