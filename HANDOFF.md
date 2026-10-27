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

The latest detector precision cleanup is committed in `d9148be`. It changed production rules, tests, the frozen REALEC report, the evaluation target schema, and the model card/verification/coverage notes. Read [reports/verification.md](reports/verification.md), the [model card](docs/model-card.md), [detector coverage](docs/detector-coverage.md), and the [training guide](training/README.md) before changing detector behavior.

## Measured state

The frozen production-browser evaluation on 184 held-out essay documents (60,825 tokens) now has **18.80% precision**, **2.74% recall**, **7.204% token misclassification**, and **0.836% false-positive rate** (TP 110, FP 475, FN 3,907, TN 56,333). The false-positive target passes; precision and total-error targets do not. Exact counts, intervals, and the latest-target/feasibility sections are in [reports/realec-independent-evaluation.json](reports/realec-independent-evaluation.json). This corpus has Russian-first-language university writers; author identifiers, valid-control judgments, and correction acceptability labels are unavailable.

The previous frozen run had 128 TP, 688 FP, 3,889 FN, 15.69% precision, 3.19% recall, 7.52% total error, and 1.211% false-positive rate. The cleanup removed 213 unannotated findings and 18 true positives: precision rose 3.11 points, total error fell 0.32 points, and false-positive rate fell 0.375 points, while recall fell 0.45 points.

On the unchanged learner-corpus development split (198 documents, 70,165 tokens, 4,721 annotated-positive tokens), the updated detector has TP 141, FP 530, FN 4,580, and TN 64,914: 21.01% precision, 2.99% recall, 7.283% total error, and 0.810% false-positive rate. The previous development baseline was 165/722/4,556/64,722 with 18.60%/3.50%/7.522%/1.103%.

The changes were precision-first and are documented in the verification report:

- Accept common British spelling variants of packaged American forms instead of flagging valid dialect.
- Abstain from parsed fragment reviews when “after/before/since that” introduces a temporal adjunct; anchor the remaining finding to the subordinating marker.
- Exclude relative “that” from parsed subject–verb agreement.
- Expand the curated direct-correction misspelling list.

`make check` passed lint, formatting, strict TypeScript checks, and 346 engine tests across 22 files. The production build passed; initial JavaScript measured 84.9 KiB gzip against the 104.7 KiB budget. `make test-training` passed all 58 project-local Python tests. No model weights changed.

## Rejected approach and feasibility

A sparse token classifier and a category-aware BiLSTM token tagger were trained development-only on REALEC training documents and rejected. At the best operating points below the false-positive ceiling they found roughly 258 and 228 true positives respectively, both with negative net detections. Do not repeat generic token-feature, sequence-tagger, or threshold sweeps as the proposed solution.

The combined latest target is mathematically constrained by the corpus prevalence. On the fixed test split, 4,017 of 60,825 tokens (6.604%) are in an annotation span. At exactly 50% precision, false positives equal true positives, so total token errors equal 4,017 regardless of recall; the 5% limit therefore requires precision above 56.91% even at perfect recall, or 97.24% at 25% recall. The current run has 365 fewer true positives than false positives and needs 1,341 more net correct detections. The 50% precision request is necessary but not sufficient.

The corpus's 4,017 gold tokens are not all objective correctness errors. Unique-token triage gives about 2,068 Grammar/Spelling/Punctuation tokens, 993 Vocabulary tokens, and 1,116 Discourse/suggestion tokens, with 159 tokens carrying more than one class. A hypothetical objective-only detector that found all 2,068 objective tokens with no false positives would leave 1,949 advisory/lexical misses (3.20% total error) and pass the 5% limit. This is the most credible technical direction left in the current corpus: a high-precision objective-error detector, not a broader generic tagger. It still would not establish writer-level independence, valid controls, or correction acceptability.

## Recommended next investigation

1. Build the objective-only detector path. Use the category split above, predicted morphology/dependencies, and adjudicated positive/negative examples. Report objective-only precision, recall, false-positive rate, and total error against the full gold denominator; do not remap labels or change denominators.
2. Keep advisory and lexical coverage separate. Suggestions, discourse, and word-choice labels often describe style or meaning rather than objective errors; do not let them inflate objective-detector targets or become course-specific behavior.
3. Source a genuinely different signal if available: an appropriately licensed, writer-separated learner corpus with explicit error categories, valid controls, and correction judgments. The current corpus alone cannot establish those properties.
4. Split by writer where identities exist and preserve a final untouched holdout. Evaluate precision, recall, false-positive rate, and total token misclassification together, with sample counts and uncertainty; check dialect/register controls, ambiguous and meaning-changing cases, and acceptable corrections.
5. Promote only candidates that improve the predeclared development gates and pass the existing regression suite. Then run the fixed evaluation once for confirmation, update the model card and verification report, and preserve the released model if the candidate regresses.

Useful entry points: `packages/engine/src/advanced-grammar.ts`, `packages/engine/src/hybrid.ts`, `packages/engine/src/spelling.ts`, `scripts/evaluate-realec.mjs`, `training/train_errors.py`, `training/predicted_syntax.py`, and the local workflow in the training guide. Do not rely on ignored scratch files in `.cache` for reproducibility.

## Suggested skills

- `diagnosing-bugs` to trace the large precision/recall gap through evaluation, annotation mapping, and current detector behavior.
- `research` if sourcing additional no-cost, license-compatible learner-writing data or researching annotation definitions.
- `implement` to build a narrowly defined candidate after its data and evaluation design are established.
- `code-review` before promoting detector or model changes.
