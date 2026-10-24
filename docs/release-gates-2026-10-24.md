# Writing and model release gates

This report records the outcome of the general-writing upgrade against the requested quality gates.

## Syntax benchmark improvement floor

The target was at least five absolute percentage points on every fixed benchmark metric below 93%, while holding every other metric. The investigated candidate does not meet that floor, so its weights were not promoted:

| Fixed evaluation | Metric | Baseline | Candidate | Change |
| --- | --- | --: | --: | --: |
| Full held-out EWT, 1,962 sentences / 24,859 tokens | POS | 94.4728% | 94.4728% | 0.0000 pp |
| Full held-out EWT | UAS | 81.6565% | 82.2117% | +0.5551 pp |
| Full held-out EWT | LAS | 77.2718% | 77.7344% | +0.4626 pp |
| Production browser, 300 sentences / 3,659 gold tokens | POS | 92.1837% | 92.1837% | 0.0000 pp |
| Production browser | UAS | 80.1585% | 80.4865% | +0.3280 pp |
| Production browser | LAS | 76.0864% | 76.2777% | +0.1913 pp |

Parser checkpoints were selected on the fixed development split before either test evaluation. The second, richer parser reached development UAS 82.5950% and LAS 78.3846%, but was not evaluated on the held-out test and is not a release candidate. The production-browser path currently aligns 3,561/3,659 gold tokens (97.32%). A 97.1837% all-gold POS score would require 3,556 correct labels, leaving only five errors among those aligned tokens. Tokenization and span coverage must improve before parser training can credibly approach the browser POS target.

The benchmark splits and tokenization accounting remain unchanged. Both evaluations use the UD English EWT corpus. They provide within-corpus syntax evidence; neither is independent learner-essay validation or an error-detection quality measure. The test results are from a single fixed evaluation and should not be interpreted as a guarantee of future performance. Approximate token-level Wilson intervals, sample counts, and the dependence caveat are in the [model card](model-card.md#candidate-training-investigation-2026-10-24).

## Writing-pattern quality gates

The product now lists 97 general writing goals with stable identifiers, proficiency stages, intent applicability, examples, valid-control guidance, correction policies, source references, and practice links only where a matching exercise skill exists. Coverage status describes code availability, not quality certification. Goals with rules remain marked `implemented-unvalidated`; other goals are `not-yet-detectable`.

No pattern currently has the plan's required independently held-out evidence for at least 95% precision, 90% recall, under 2% false positives on valid controls, and 90% acceptable direct corrections. The small authored and synthetic regressions are development tests, not independent learner-writing evidence. Their counts and uncertainty are reported separately. Existing corrections are suggestions and require an explicit learner action; no text is rewritten automatically.

The [writing progression](writing-progression.md) explains how the goal map uses public early-learning and writing frameworks as general references without creating course-specific behavior. The Head Start ELOF is not treated as a child assessment or readiness checklist.
