# Scorecard

Every gate is frozen before a candidate is measured. `make scorecard` reads the tracked reports and writes [`reports/scorecard.json`](https://github.com/richie-rich90454/linguorithm/blob/main/reports/scorecard.json); this page is the human-readable view of that file.

**Current state: 8 passing, 0 failing, 3 pending.**

## Passing gates

| Gate | Target | Current |
| --- | --- | --- |
| Legacy fixed-test precision | ≥ 15.69%, no regression | 15.69% |
| Legacy fixed-test recall | ≥ 3.19%, no regression | 3.19% |
| Legacy total token error | ≤ 7.525%, no regression | 7.525% |
| Legacy false-positive rate | ≤ 1.211%, no regression | 1.211% |
| Valid-English controls | 0 confirmed false positives | 107 of 107 clean |
| Offline behaviour | 0 external requests; offline reload renders | 32 same-origin requests, 0 external |
| Python/browser parity | maximum difference ≤ 0.0001 | 0.0000019 |
| Benchmark v2 splits | deduplicated, writer-separated, sealed test | 180 test documents; 36 duplicates dropped |

## Pending gates

These cannot pass until the v2 labels are collected and adjudicated. No v2 accuracy claim is made.

| Gate                     | Target                            | Current      |
| ------------------------ | --------------------------------- | ------------ |
| v2 precision at emission | ≥ 60%, Wilson lower bound ≥ 55%   | not measured |
| v2 objective recall      | ≥ 25%                             | not measured |
| v2 calibration           | expected calibration error ≤ 0.05 | not measured |

## How a gate passes

1. The candidate is frozen: rules, weights, settings, and threshold.
2. The evaluation script is frozen.
3. The sealed split is opened once.
4. A regression in any legacy field rejects the candidate even if another field improves.
5. A failed candidate is published with its counts, not hidden.

The scorecard is deliberately narrow. It measures detection, precision, false positives, calibration, parity, and offline behaviour. It does not measure learning benefit, correction acceptability, or representativeness; those need separate studies.
