# Local model release ewt-1

These are compact discriminative models. They label tokens, dependencies, and bounded error candidates; they do not generate prose.

| Component | Training and evaluation | Measured result |
| --- | --- | --- |
| POS | Word embeddings, character CNN, bidirectional LSTM, linear-chain CRF; 12 epochs; validation checkpoint selection | 94.47% token accuracy, 24,859 held-out tokens |
| Dependency parser | Arc-standard transition MLP; beam 4; 6 epochs; predicted POS; projective oracle training | UAS 81.66%, LAS 77.27%, 1,962 held-out sentences |
| Error classifier | Context word/POS embeddings and morphology features; Platt calibration and threshold selection on separate validation halves | Synthetic agreement precision 99.34%, recall 98.05%; synthetic spelling precision/recall 100%; natural essay accuracy unestablished |
| Correction ranker | Pairwise logistic regression; lexical frequency, Kneser–Ney bigram context, edit distance; train-only fit | 81.53% top-1 on 769 held-out controlled deletion cases |
| Dictionary | SCOWL-derived US English, affix expansion, complete upstream notices | 121,191 recognized forms; candidate retrieval limited to common training words |

Pinned data: UD English EWT r2.16, commit `4c89b5833a70aa5ed3a00bad2f23f57992cc7df8`, CC-BY-SA 4.0. Source files and SHA-256 provenance are in `training/datasets/ewt-manifest.json`. Official document splits are retained and exact duplicate sentences excluded; author/prompt independence is unavailable. Training split: 12,542 sentences; validation: 1,933; test: 1,962. Syntax sequences are limited to 128 tokens; longer sentences use fallback analysis. Nonprojective training trees without valid oracle derivations are excluded (287 sentences).

The dictionary manifest pins its upstream commit and records composite permissive notices, including SCOWL, WordNet, VarCon, and Ispell. Preserve `apps/web/public/models/licenses/` when distributing the build. Do not relabel the dictionary as solely MIT. Corpus/derived-resource attribution and share-alike requirements remain applicable; the application’s own source is separate.

Every registry resource and model weight is checked with SHA-256 before inference. Python versus browser ONNX emissions pass tolerance 0.0002 in Chromium, Firefox, WebKit, and mobile Chromium emulation. Confidence is separate from POS/beam scores. Only synthetic-task classifier probabilities are calibrated; classifier suggestions remain review-only on essays. Unsupported classifier categories are unavailable. No numeric natural-error confidence is invented.

Int8 candidates reduce tagger weights from 2,628,302 to 919,585 bytes, parser from 1,383,856 to 350,284, and classifier from 908,987 to 231,256. On the full held-out syntax set, int8 POS is 94.46%, UAS 81.66%, LAS 77.30%. Float32 remains active because browser parity has been verified for that variant; quantization alone does not authorize promotion. See `reports/quantization-evaluation.json` and `reports/model-packaging.json`.

Known limits: web/edited-English domain shift, synthetic errors, imperfect tokenization of web identifiers, incomplete rare-word recognition, ambiguous pronouns/modifiers, and educational validity. A clean report cannot certify correctness. Parser accuracy does not establish error-detection precision. Neither a Grammarly comparison nor a student learning benefit has been demonstrated.

Reproduce with the isolated commands in `training/README.md`. Frontend builds consume completed artifacts and never train models. The versioned model bundle in models/releases is included with the source and restored locally during normal builds. Raw corpora, training runtimes, and generated candidates are optional and ignored; they are not required to build the browser application.
