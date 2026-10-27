# Linguorithm accuracy work handoff

## Active objective

Continue improving Linguorithm's fully local writing detector for real tutoring use, without generative language models. The latest explicit benchmark request is **at least 50% precision, at most 5% total token misclassification, and false-positive rate below 1.21%**. Earlier requests also set stricter goals, including sub-0.5% error rates; keep those as long-term goals and report each metric honestly. Do not claim a target is met unless a frozen, reproducible evaluation supports it.

The current production bar is stricter: **no metric may regress**, and a production-grade change needs at least a 20x improvement in useful detection. Treat that as a gate, not a slogan. The present corpus cannot demonstrate it.

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

The latest no-regression change is committed in `b4901ab`. A precision-first candidate had improved precision and false-positive rate but reduced recall; it was reverted. The retained changes are a temporal “after/before/since that” guard for parsed fragment reviews, an expanded curated misspelling list, and latest-target/feasibility reporting in `scripts/evaluate-realec.mjs`. Read [reports/verification.md](reports/verification.md), the [model card](docs/model-card.md), [detector coverage](docs/detector-coverage.md), and the [training guide](training/README.md) before changing detector behavior.

## Measured state

The fixed production-browser evaluation on 184 held-out essay documents (60,825 tokens) is unchanged from the previous frozen baseline: TP 128, FP 688, FN 3,889, TN 56,120; **15.69% precision**, **3.19% recall**, **7.525% token misclassification**, and **1.211% false-positive rate**. Exact counts, intervals, latest-target checks, and the feasibility section are in [reports/realec-independent-evaluation.json](reports/realec-independent-evaluation.json). The false-positive target is not met by 0.0011 points (688 observed against a 687 limit).

On the unchanged development split (198 documents, 70,165 tokens, 4,721 annotated-positive tokens), the retained guard removes 32 false positives with no true-positive change: TP 165, FP 690, FN 4,556, TN 64,754; **19.30% precision**, **3.50% recall**, **7.477% total error**, and **1.054% false-positive rate**. The previous development result was 165/722/4,556/64,722 with 18.60%/3.50%/7.522%/1.103%. All four fields improve or remain equal.

The precision-first candidate that was reverted reached 18.80% precision, 2.74% recall, 7.204% total error, and 0.836% false-positive rate on the fixed test. It is not shipped because recall fell 0.45 points.

## The 20x production-grade bar

The current fixed-test detector finds 128 true-positive tokens. A 20x improvement is 2,560 true positives. Holding false positives at or below the current 688 would give precision about 78.8%, recall about 63.7%, total token error about 3.53%, and false-positive rate at the 1.21% ceiling. That operating point would pass the latest target combination, but no rule, threshold, or candidate so far has approached it.

The corpus limits what a correctness-only detector can reach. Unique-token triage of the 4,017 fixed-test gold tokens gives about 2,068 Grammar/Spelling/Punctuation tokens, 993 Vocabulary tokens, and 1,116 Discourse/suggestion tokens, with 159 tokens carrying more than one class. A perfect objective-only detector would find 2,068 true positives — about 16.2x the current count — and still leave 1,949 lexical/advisory misses (3.20% total error). Reaching 20x therefore requires detecting at least 492 additional lexical or discourse tokens, or using a corpus with more objective errors. Generic token classifiers, a category-aware BiLSTM, and rule/threshold sweeps have not come close; the best development-only classifiers found roughly 228–258 true positives under the false-positive ceiling.

At exactly 50% precision, false positives equal true positives, so total token errors equal the 4,017 gold tokens (6.604%) regardless of recall. The 5% limit requires precision above 56.91% even at perfect recall, and 97.24% at 25% recall. The current fixed-test run has 560 fewer true positives than false positives and needs 1,536 more net correct detections. These are exact consequences of the annotation prevalence, not model estimates.

## Rejected approaches

- A sparse token classifier trained on REALEC training documents using token identity, affixes, neighboring words, and punctuation reached 258 true positives at its best-recall operating point below the 1.21% false-positive ceiling, with 24.67% precision and 7.48% total error.
- A category-aware BiLSTM with word, character-CNN, and shape features reached 228 true positives at its best-recall operating point below the false-positive ceiling, with 22.4% precision. Its development oracle threshold still had negative net detections.
- Precision-first rule filtering improved precision but reduced recall; it was reverted under the no-regression gate.
- A sentence-initial missing-article rule found 4 true positives and 14 false positives on development; it was rejected.

Do not repeat generic token-feature, sequence-tagger, threshold, or rule-filter sweeps as the proposed solution.

## Recommended next investigation

1. Build or license a materially stronger objective-error detector. The current corpus cannot support 20x from rules; a production-grade jump needs a model trained on writer-separated, adjudicated objective errors with usable corrections. Use predicted morphology/dependencies and category-specific targets; keep advisory and lexical labels separate.
2. If using REALEC, preserve the fixed test split as untouched and use the training/documents split for fitting. The corpus lacks writer identities, valid controls, and correction-acceptability labels, so it cannot alone justify production-grade claims.
3. Evaluate precision, recall, false-positive rate, total token misclassification, and net detections together, with sample counts and uncertainty. Reject any candidate that regresses a metric, even if it improves another.
4. Check dialect/register controls, ambiguous and meaning-changing cases, and acceptable corrections before enabling tutoring feedback. Do not reduce false positives by suppressing valid learner language or dialects.
5. Promote only candidates that improve all predeclared gates and pass the regression suite. Then run the fixed evaluation once for confirmation, update the model card and verification report, and preserve the released model if the candidate regresses.

Useful entry points: `packages/engine/src/advanced-grammar.ts`, `packages/engine/src/hybrid.ts`, `packages/engine/src/spelling.ts`, `scripts/evaluate-realec.mjs`, `training/train_errors.py`, `training/predicted_syntax.py`, and the local workflow in the training guide. Do not rely on ignored scratch files in `.cache` for reproducibility.

## Suggested skills

- `diagnosing-bugs` to trace the large precision/recall gap through evaluation, annotation mapping, and current detector behavior.
- `research` if sourcing additional no-cost, license-compatible learner-writing data or researching annotation definitions.
- `implement` to build a narrowly defined candidate after its data and evaluation design are established.
- `code-review` before promoting detector or model changes.
