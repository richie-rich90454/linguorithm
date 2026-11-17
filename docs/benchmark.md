# Benchmark

Benchmark v2 is being rebuilt. Until its test labels are sealed, the only published numbers are the frozen v1 baseline below. They are a measurement of the current build, not a quality claim.

## Frozen v1 baseline

The production browser worker was run once on a fixed, document-held-out split of the manually annotated REALEC learner-essay corpus: 184 documents and 60,825 Unicode tokens, of which 4,017 tokens carry at least one error annotation. Source text stays in the ignored local cache; the tracked [report](https://github.com/richie-rich90454/linguorithm/blob/main/reports/realec-independent-evaluation.json) contains aggregate counts and label names only.

| Outcome             | Annotated error | Unannotated |
| ------------------- | --------------: | ----------: |
| Finding reported    |          TP 128 |      FP 688 |
| No finding reported |        FN 3,889 |   TN 56,120 |

| Metric                                      |  Value | 95% Wilson interval |
| ------------------------------------------- | -----: | ------------------- |
| Precision                                   | 15.69% | 13.35–18.34%        |
| Recall                                      |  3.19% | 2.69–3.78%          |
| F0.5                                        |  8.79% | 7.02–10.64%         |
| Total token error, `(FP + FN) / all tokens` | 7.525% | —                   |
| False-positive rate on unannotated tokens   | 1.211% | 1.12–1.30%          |

A 1,000-replicate document-cluster bootstrap widens these intervals: precision 11.97–20.16%, recall 2.47–3.89%, F0.5 7.02–10.64%, false-positive rate 0.98–1.47%. Tokens inside a document are correlated, so the Wilson intervals are optimistic and secondary.

The reference is narrow: Russian-L1 university essays, no writer or prompt identifiers, no valid-English controls, and no adjudicated correction judgments. It cannot establish performance for preschool through advanced secondary writers, and it cannot satisfy a per-pattern precision or direct-correction gate.

## Why 20× is arithmetically impossible on this reference

Twenty times the measured recall is 63.7%, which requires **2,560 true-positive tokens** out of the 4,017 annotated tokens.

Only about **2,068** of those annotations are objective gold under Linguorithm's goal definitions: clear, correction-ready errors that do not depend on writer intent, register, or a contested alternative. The remaining spans are ambiguous, style-adjacent, or outside the product's taxonomy.

2,560 exceeds 2,068 by roughly 492 tokens. A detector that found every objective error and no others would cap recall near **51.5%** on the 4,017-token denominator. The requested 20× target is unreachable by arithmetic on this split before any modelling question is asked.

## Near-duplicate contamination

A content audit found that **5 of 184** test documents — 9,312 tokens and 569 gold tokens — have an exact or near-duplicate in the train/development pool. Even perfect label transfer from those duplicates would reach only:

| Metric              | Best case with leakage |
| ------------------- | ---------------------: |
| True positives      |                    697 |
| Precision           |                  50.3% |
| Recall              |                  17.3% |
| Total token error   |                  6.59% |
| False-positive rate |                 1.211% |

That still fails every proposed gate. The v1 split cannot support an independent generalization claim, and it must not be deduplicated after inspection in an attempt to rescue the result.

## Benchmark v2 design

v2 is built before the test set is opened.

1. **Candidate pool.** A documented, deduplicated pool of naturally occurring learner writing with per-document provenance. Test sentences never enter training, rule design, or prompt tuning.
2. **Two independent annotators.** Each document is labelled blind against the published schema: span, category, correction, accepted alternatives, and meaning preservation.
3. **Adjudication.** A third reviewer resolves disputed spans, categories, and corrections. Original submissions are retained, and adjudicated labels are never reported as independent agreement.
4. **Matched controls.** Every target pattern gets valid-English controls matched on dialect, register, genre, and length, so false positives are measured rather than inferred.
5. **Writer-separated splits.** Connected documents — same author, prompt, or source — are grouped and assigned to one split. Near-duplicates are removed before splitting.
6. **Sealed test.** Prompts and reference labels are frozen and withheld. Rules, weights, settings, and the evaluation script are frozen before the test is opened. Any fix driven by test inspection requires a new sealed cohort.

## v2 preparation status

The v2 tooling is built; the labels are not collected yet.

| Step | Current state |
| --- | --- |
| Near-duplicate audit | 42 duplicate components found at word 5-gram Jaccard ≥ 0.8; 18 components cross split boundaries |
| Contaminated documents removed | 36 total (train 17, development 8, test 11) |
| v2 documents | 842 train / 180 development / 180 test |
| v2 tokens | 281,820 / 58,862 / 57,956 |
| Writer proxy | 1,152 clusters at 0.985; largest cluster 5; 1,107 singletons |
| Recall probe | 200 development sentences across 180 documents |
| Candidate pool | 572 items: 124 findings, 248 matched controls, 200 probes |
| Annotations collected | 0 of 572 |

Writer identity is unavailable in REALEC, so clusters are a proxy from function-word profiles and sentence statistics. “Cluster never split” holds only within that proxy's accuracy. Paraphrase reuse and copies shorter than five words survive deduplication.

The annotation workflow is in [`tools/annotate`](https://github.com/richie-rich90454/linguorithm/tree/main/tools/annotate). Two annotators label independently; a third pass adjudicates. `make benchmark-v2` rebuilds the pool and `make benchmark-v2-manifest` rebuilds the deduplicated splits.

`make scorecard` aggregates the frozen gates into `reports/scorecard.json`. The [scorecard](/scorecard) shows the current state: legacy gates, controls, offline proof, parity, and the v2 split freeze pass; the three v2 accuracy gates remain pending.

## Predeclared gates

These thresholds are published before the v2 result exists. None are met by the current build.

| Gate                              | Predeclared threshold                |
| --------------------------------- | ------------------------------------ |
| Diagnostic precision              | ≥ 60%, with Wilson lower bound ≥ 55% |
| Objective recall                  | ≥ 25%                                |
| Valid-control false-positive rate | < 0.5%                               |
| Total token error                 | ≤ 4%                                 |
| Legacy regression                 | No regression on the frozen v1 suite |
| Calibration                       | Expected calibration error ≤ 0.05    |

Passing these gates would be an engineering signal, not independent certification. Annotation independence, representativeness, control clustering, semantic review, and operational measurement still need their own study record. See the [evaluation protocol](/evaluation-protocol) for the full annotation and uncertainty contract.
