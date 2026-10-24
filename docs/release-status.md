# Specification implementation and release status

The original specification remains in engineering-specification.md. This inventory distinguishes implemented engineering from evidence requiring external data or people.

| Area | Delivered |
| --- | --- |
| Foundation/tooling | SolidJS, strict TS, pnpm workspaces and lock, exact Oxlint/Oxfmt setup, local launchers/runtimes/caches, CI |
| Essay laboratory | Whole-document cancellable worker, UTF-16 source spans, revision protection, paragraph/sentence caches, typed bounded edits, rechecks, immutable history, export |
| Statistical syntax | Actual EWT-trained character-CNN/BiLSTM/CRF, Viterbi, transition parser with beam 4 and alternatives, neural morphology and dependency diagrams |
| Hybrid diagnosis | Conservative fallback rules; parsed auxiliary agreement, subject case, clause boundaries, comparisons, parallel forms, possible modifier/reference issues; optional document tense/repetition observations |
| Statistical support | Contextual synthetic-error classifier, category calibration/thresholds, sparse logistic baseline, Kneser–Ney context, fitted correction ranker, 121,191-form dictionary, personal exceptions |
| Model delivery | Versioned SHA-256 resources, full attribution, real Python/ONNX/browser parity, explicit fallback, int8 size/quality comparison, offline runtime caching |
| Learning | Seven-skill prerequisite graph, BKT, scheduled reviews, heap queue, authored MCQs and validated mutations, typed repairs, hints, repeat-aware records, CSV and JSON exports |
| Assessment | Persistent resumable pre/post/delayed/transfer-item sessions, unseen questions, no hints/source answers before submission, seven-day delayed gate, separate mastery evidence |
| Materials | Seven formats; inert HTML; bounded actual ZIP decompression; DOCX structure; PPTX slide order and tables; XLSX sheets/cell coordinates and cached values; PDF page labels; headings/lists/tables; RAKE/TF-IDF key phrases; explicit definitions; source-grounded quizzes and abstention |
| Persistence | Dexie v2 migration, documents/revisions/reports/models/preferences/materials/attempts/skills/assessments, schema-validated v1/v2 backups, additive restore with active-state refresh |
| Privacy/deployment | Local-only paths, no essay uploads, CSP, local fonts/models, static PWA, narrow-screen and reduced-motion support |
| Verification | Unit/property/regression tests, all major browser engines, model parity/integrity/offline tests, accessibility/privacy captures, performance/bundle reports, separate code review |

The optional Fastify/PostgreSQL backend remains disabled and absent: §12.2 explicitly makes introduction conditional on a need for deeper server analysis or synchronization. The initial product needs no account. No server, synchronization, OCR, or generative service is silently introduced.

Remaining external release gates:

- Representative naturally occurring learner essays with authorized access and independently established reference labels. EWT is web/edited English; synthetic mutations cannot replace this. Official learner resources found during research require separate agreements or restrict commercial use.
- Independent category-level precision/recall, correction acceptability, and valid-control false-positive estimates with sufficient sample size. Development regression intervals are reported but do not establish the proposed 95%/75%/90% targets.
- Qualified educator review of the curriculum and mutation families. Programmatic answer validation does not establish pedagogical quality.
- A documented blinded competitor comparison and real student pre/post/delayed/transfer-writing study. The app now records the necessary assessment events, but no participants or outcomes are invented. Item-level unseen questions do not prove transfer to unfamiliar constructions or actual writing.
- Measurements on physical supported phones and actual browser peak memory. Mobile emulation and sampled memory are identified as such.

The [model card](model-card.md#production-browser-generalization-check) reports full held-out component metrics separately from the 300-sentence production-browser EWT check. That check covers five source genres within the same corpus: all-gold POS/UAS/LAS are 92.18%/80.16%/76.09%, including tokenization failures. It does not satisfy the independent learner-error release gate.

No classifier category currently passes the release emission gate. On 63 controlled agreement mutation/control pairs, emitted classifier findings detect 0/63 targets; the complete hybrid detects 47/63, misses 16/63, and has 0/63 target false positives on source controls. Authored clean probes show zero conservative false positives and one review warning across 26 cases. These bounded development results do not establish natural-essay precision or recall. Neural findings remain review-only on essays. Narrow deterministic rules retain explicit heuristic certainty policies. Unsupported constructions produce no automatic rewrite. No claim of complete English coverage, competitor superiority, or demonstrated learning benefit is made.
