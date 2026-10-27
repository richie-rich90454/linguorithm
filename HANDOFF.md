# Linguorithm accuracy work handoff

## Active objective

Continue improving Linguorithm's fully local writing detector for real tutoring use, without generative language models. The latest explicit benchmark request is **at least 50% precision, at most 5% total token misclassification, and false-positive rate below 1.21%**. Earlier requests also set stricter goals, including sub-0.5% error rates; keep those as long-term goals and report each metric honestly. Do not claim a target is met unless a frozen, reproducible evaluation supports it.

Keep the product general across writing levels and intents. Preserve the current interface identity, accessible behavior, no-full-capital text rule, and prohibition on left-border accent stripes. Do not add course-specific detector behavior.

## Project constraints

- Keep runtimes, dependencies, datasets, models, and caches inside this repository. Do not install global packages.
- Use `make` for project workflows.
- Keep runtime inference offline and local; no generative-model integration or paid service.
- Preserve current passing behavior and controls. Do not reduce false positives by suppressing valid learner language or dialects.
- Use the development split for candidate analysis. Keep the fixed learner-corpus test split untouched until a candidate and its operating threshold are frozen.
- User's standing preference, if delegation is explicitly requested: use the Luna model at extra-high effort for subagents.

## Current repository state

Repository: `C:\Users\rjian\Desktop\grammar-practice`.

The working tree was clean after the last two single-file Conventional Commits:

- `8c01d55 docs(verification): record the rejected learner-corpus token-classifier experiment`
- `51da674 chore(git): describe classifier experiment evidence precisely`

The report commit documents a failed development-only approach; production code and model assets did not change. Read [reports/verification.md](reports/verification.md), the [model card](docs/model-card.md), [detector coverage](docs/detector-coverage.md), and the training guide before changing detector behavior. The preceding commit describes the experiment in `verification.md`.

## Measured state and rejected approach

The frozen production browser evaluation on 184 held-out essay documents (60,825 tokens) has **15.69% precision**, **3.19% recall**, **7.52% token misclassification**, and **1.2111% false-positive rate**. It misses all three latest requested thresholds. Exact counts and limitations are in [reports/realec-independent-evaluation.json](reports/realec-independent-evaluation.json). This corpus has Russian-first-language university writers; author identifiers, valid-control judgments, and correction acceptability labels are unavailable.

On the unchanged learner-corpus development split (198 documents, 70,165 tokens, 4,721 annotated-positive tokens), production has 18.60% precision, 3.50% recall, 7.52% total misclassification, and 1.10% false-positive rate. A new sparse token classifier was trained on training documents using token identity, character affixes, nearby words, and punctuation. At a 50% precision threshold it found only 18 true positives and 18 false positives, with 0.38% recall and 6.73% token misclassification. At its best-recall operating point below the 1.21% false-positive ceiling, it found 258 true positives (5.46% recall), with 24.67% precision and 7.48% token misclassification. This did not meet the target combination and was rejected; no weights or production findings were changed. The fixed test split was not used in this experiment.

On this development sample, the combined target requires at least 2,004 true positives (42.45% recall), no more than 791 false positives, and no more than 3,508 total mistakes. The generic token classifier reached 258 true positives under the false-positive ceiling. Do not repeat generic token-feature or threshold sweeps as the proposed solution.

The corpus's largest label groups include suggestions, discourse, lexical choice, articles, punctuation, tense, spelling, and prepositions. These labels do not map one-to-one to Linguorithm's 100 goals, and some annotations are stylistic or semantic rather than objective correctness errors. Treat overlap as triage evidence, not validated precision. Do not remap labels, edit the fixed test set, or change denominators just to pass a metric.

## Recommended next investigation

1. Inspect the learner-corpus annotation definitions and per-label recall in the existing reports. Separate objective grammar and spelling errors from optional style or discourse advice before using labels as detector targets.
2. Identify a genuinely different source of signal: an appropriately licensed, writer-separated learner corpus with explicit error categories, valid controls, and correction judgments; or a narrowly scoped detector with adjudicated positive and negative examples. The current corpus alone cannot establish those properties.
3. If training on existing data, use category-specific targets and observable production features (for example predicted morphology/dependencies) rather than a single binary bag of neighboring tokens. Split by writer where identities exist and preserve a final untouched holdout.
4. Evaluate precision, recall, false-positive rate, and total token misclassification together, with sample counts and uncertainty. Check dialect/register controls, ambiguous and meaning-changing cases, and acceptable corrections before enabling tutoring feedback.
5. Promote only candidates that improve the predeclared development gates and pass the existing regression suite. Then run the fixed evaluation once for confirmation, update the model card and verification report, and preserve the released model if the candidate regresses.

Useful entry points: `packages/engine/src/advanced-grammar.ts`, `packages/engine/src/hybrid.ts`, `training/train_errors.py`, `training/predicted_syntax.py`, `scripts/evaluate-realec.mjs`, and the local workflow in the training guide. Do not rely on ignored scratch files in `.cache` for reproducibility.

## Suggested skills

- `diagnosing-bugs` to trace the large precision/recall gap through evaluation, annotation mapping, and current detector behavior.
- `research` if sourcing additional no-cost, license-compatible learner-writing data or researching annotation definitions.
- `implement` to build a narrowly defined candidate after its data and evaluation design are established.
- `code-review` before promoting detector or model changes.
