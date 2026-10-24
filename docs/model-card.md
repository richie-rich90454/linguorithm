# Local model release ewt-1

These are compact discriminative models. They label tokens, dependencies, and bounded error candidates; they do not generate prose.

| Component | Training and evaluation | Measured result |
| --- | --- | --- |
| POS | Word embeddings, character CNN, bidirectional LSTM, linear-chain CRF; 12 epochs; validation checkpoint selection | 94.47% token accuracy, 24,859 held-out tokens |
| Dependency parser | Arc-standard transition MLP; beam 4; 6 epochs; predicted POS; projective oracle training | UAS 81.66%, LAS 77.27%, 1,962 held-out sentences |
| Error classifier | Compact ONNX context model trained on actual frozen POS/parser predictions, with train-only corpus-derived mutation paradigms and document-disjoint validation | No category currently passes the source-disjoint calibration/emission gate. Agreement lacks a threshold with at least 95% validation precision and 30 eligible findings; verb-form support is insufficient; spelling uses the dictionary path; punctuation is disabled. |
| Correction ranker | Pairwise logistic regression; lexical frequency, Kneser–Ney bigram context, edit distance; train-only fit | 81.53% top-1 on 769 held-out controlled deletion cases |
| Dictionary | SCOWL-derived US English, affix expansion, bounded full-dictionary retrieval, complete upstream notices | 121,191 recognized forms; candidate search is capped by token length, visited trie nodes, candidate count, edit distance, and returned suggestions |

Pinned data: UD English EWT r2.16, commit `4c89b5833a70aa5ed3a00bad2f23f57992cc7df8`, CC-BY-SA 4.0. Source files and SHA-256 provenance are in `training/datasets/ewt-manifest.json`. Official document splits are retained and exact duplicate sentences excluded; author/prompt independence is unavailable. Training split: 12,542 sentences; validation: 1,933; test: 1,962. Syntax sequences are limited to 128 tokens; longer sentences use fallback analysis. Nonprojective training trees without valid oracle derivations are excluded (287 sentences).

The dictionary manifest pins its upstream commit and records composite permissive notices, including SCOWL, WordNet, VarCon, and Ispell. Preserve `apps/web/public/models/licenses/` when distributing the build. Do not relabel the dictionary as solely MIT. Corpus/derived-resource attribution and share-alike requirements remain applicable; the application’s own source is separate.

Every registry resource and model weight is checked with SHA-256 before inference. Python versus browser ONNX emissions pass tolerance 0.0002 in Chromium, Firefox, WebKit, and mobile Chromium emulation. Training uses predicted syntax features, and the release pipeline verifies exact browser feature parity plus actual Python ONNX versus browser WASM classifier score parity before packaging. The 300-sentence production-worker report records the served registry, weight, and worker hashes. Agreement and perfect-form grammar rules use attested train-derived paradigms and preserve ambiguity by abstaining. Unsupported classifier categories are unavailable; no numeric natural-error confidence is invented.

## Production-browser generalization check

[The recorded report](../reports/generalization.json), generated on 2026-10-24, runs the actual production browser worker with model state `ready` on 411 cases. Its syntax fixture contains 300 official-test EWT sentences, selected by seeded SHA-256 ordering before inspecting predictions (seed 20261024). Exact token-sequence and document overlap with train/dev is excluded; sentences must align to original text and contain at most 128 tokens. This is held-out **within-corpus** evaluation: EWT was also used for model development and test reporting. It is neither a new independent dataset nor an error-annotated learner-essay benchmark; author/prompt independence is unverified. The five source genres follow official EWT sentence-ID prefixes.

| Source genre | Sentences | Gold tokens |        POS |        UAS |        LAS |
| ------------ | --------: | ----------: | ---------: | ---------: | ---------: |
| Answers      |        71 |         917 |     91.93% |     81.68% |     78.52% |
| Email        |        77 |         786 |     91.48% |     79.64% |     76.46% |
| Newsgroup    |        37 |         547 |     89.76% |     74.41% |     68.01% |
| Reviews      |        86 |         835 |     92.69% |     84.55% |     80.00% |
| Weblog       |        29 |         574 |     95.12% |     77.53% |     73.69% |
| **All**      |   **300** |   **3,659** | **92.18%** | **80.16%** | **76.09%** |

These scores include punctuation and count unmatched spans and lexical-fallback tokens as incorrect. POS measures token labels; UAS measures dependency heads; LAS additionally requires the exact basic UD relation label. Exact sentence tokenization matches on 229/300 sentences. Neural spans align to 3,561/3,659 gold tokens (97.32%); conditional on those aligned tokens, POS/UAS/LAS are 94.72%/82.36%/78.18%. Those conditional scores exclude alignment failures and must be read with coverage. Without punctuation, all-gold scores are 91.82%/80.80%/76.17% on 3,214 tokens. Gold syntax is never supplied to inference. Learned syntax differs from rules-only output on 299/300 sentences; difference alone does not demonstrate an accuracy improvement.

No classifier category is activated by the current emission gate. The gold-guided synthetic agreement check selects one `is/are/was/were/has/have` number mutation per eligible source sentence, then sends only corrupted text through production inference. Across 63 mutation/control pairs, the complete hybrid has TP 47, FN 16, FP 0, TN 63: 74.60% target detection and 0/63 target false positives. Classifier-only emitted findings have TP 0, FN 63, FP 0, TN 63. These counts are after production diagnostic resolution, where an overlapping deterministic finding can suppress a model finding. Source controls can contain unrelated errors; this is target-token detection, not natural-essay precision or correction acceptability.

The separate manually authored development probes detect the expected target and offer its correction in 4/5 agreement, 3/4 verb-form, 2/4 usage, 0/1 boundary, and 0/1 pronoun cases. Among 26 authored clean cases, zero have conservative false positives and one has a review warning. The probes are not independently reviewed or representative of learner essays. All 411 cases pass source/edit integrity checks over 151 proposals. The report records zero calibrated and 111 uncalibrated review warnings; its confidence policy permits numeric synthetic-task probabilities only for the calibrated ASCII, tokenization-stable cohort with learned subject morphology. No natural-essay confidence or learning benefit is established, and this evaluation does not change model weights.

Int8 candidates reduce tagger weights from 2,628,302 to 919,585 bytes, parser from 1,383,856 to 350,284, and classifier from 908,987 to 231,256. On the full held-out syntax set, int8 POS is 94.46%, UAS 81.66%, LAS 77.30%. Float32 remains active because browser parity has been verified for that variant; quantization alone does not authorize promotion. See `reports/quantization-evaluation.json` and `reports/model-packaging.json`.

Known limits: web/edited-English domain shift, synthetic errors, imperfect tokenization of web identifiers, fallback analysis beyond the bounded neural sentence length, rare or unseen morphological paradigms, ambiguous pronouns/modifiers, and educational validity. A clean report cannot certify correctness. Parser accuracy does not establish error-detection precision. Neither a Grammarly comparison nor a student learning benefit has been demonstrated.

Reproduce with the isolated commands in `training/README.md`. Frontend builds consume completed artifacts and never train models. The versioned model bundle in models/releases is included with the source and restored locally during normal builds. Raw corpora, training runtimes, and generated candidates are optional and ignored; they are not required to build the browser application.
