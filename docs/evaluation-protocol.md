# Annotation, comparison, and release protocol

This is a prospective protocol and executable reporting format. The original unit fixtures exercise the accounting; they establish no engine accuracy, competitor advantage, or learning benefit. The comparison command consumes supplied JSON predictions. It does not contact competitors, run an analysis system, generate reference labels, or replace independent human review.

## Run the comparison

Run from the repository root in PowerShell. GNU Make selects the project-local task runner and dependencies; no global installation is needed.

```powershell
make compare ARGS="--help"
make compare ARGS="--corpus data/gold.json --run data/full.json --run data/rules-only.json --run data/without-parser.json --run data/blinded-comparator.json --annotations data/independent-submissions.json --supported Grammar,Punctuation --supported-patterns Grammar=comma-splice=review,Grammar=subject-verb-agreement=direct --top-k 3 --bootstrap 2000 --seed 20261022 --out reports/independent-comparison.json"
```

For a release check, add `--require-gates` inside `ARGS`. It requires at least one explicit `--supported-patterns` entry. Declare each annotation category/subtype with `direct` when a safe direct correction is part of the product contract, or `review` when the product intentionally offers no direct correction. Exit codes are 0 for a completed report, 1 for a failed declared release gate, and 2 for invalid input. Without `--require-gates`, failed gates are still included in the report. Optional `--supported` category checks are broader supplemental gates. `Style` is always scored separately and cannot be declared as a grammatical pattern.

All runs must contain exactly the documents in the selected `--split` (default `test`). A source-text or corpus-version mismatch, incomplete run, unresolved gold document, duplicate identifier, or cross-split group/text leak stops evaluation. Missing predictions must be represented by an explicit empty `predictions` array, so missing runs cannot silently improve scores. Unknown confidence is `null`; unavailable timings or memory are omitted.

## Annotation contract

The strict Zod schemas are in `packages/engine/src/annotations.ts`. Every error records a document and sentence ID, a half-open source span `[start, end)`, category, subtype, original and corrected text, accepted alternatives, a grammatical relationship with source evidence, confidence, severity, style status, annotator provenance, and adjudication. Offsets are JavaScript UTF-16 code units. Insertions use `start === end` and an empty original; deletions use an empty correction. Boundaries cannot bisect a surrogate pair. Source text is preserved literally; no quote, whitespace, Unicode, or line-ending normalization is applied to annotations.

Categories are `Grammar`, `Punctuation`, `Spelling`, `Usage`, and `Style`. Subtypes and relationship types come from the study's versioned annotation guidelines; the harness does not infer or silently translate them. `isStyle` must agree with the category. A stylistic preference must never become a grammatical error simply to increase recall. Alternatives are distinct replacement strings for the same annotated span. Multiple edits needed for one error should use a span that contains the whole correction; unrelated errors retain separate labels.

The following complete, original miniature corpus can be saved as `reports/example-gold.json`. Its labels are illustrative test fixtures, not independent benchmark labels.

```json
{
    "format": "grammar-annotations",
    "id": "original-example",
    "version": "1",
    "description": "Original illustrative fixtures; no performance claim",
    "documents": [
        {
            "id": "example-error",
            "text": "She write.",
            "variety": "en-US",
            "split": "test",
            "groups": { "authorId": "fixture-a", "sourceId": "fixture-a", "promptId": "fixture-a" },
            "provenance": {
                "source": "Original example",
                "license": "Project-owned fixture",
                "permittedUse": ["testing"],
                "consent": "not-required"
            },
            "reviewStatus": "adjudicated",
            "validControl": false,
            "sentences": [{ "id": "s1", "start": 0, "end": 10, "text": "She write." }],
            "errors": [
                {
                    "id": "e1",
                    "documentId": "example-error",
                    "sentenceId": "s1",
                    "start": 4,
                    "end": 9,
                    "category": "Grammar",
                    "subtype": "subject-verb-agreement",
                    "original": "write",
                    "corrected": "writes",
                    "acceptedAlternatives": [],
                    "relationship": {
                        "type": "subject-predicate",
                        "evidence": [{ "start": 0, "end": 3, "text": "She", "role": "subject" }]
                    },
                    "confidence": 1,
                    "severity": "moderate",
                    "isStyle": false,
                    "annotators": [
                        {
                            "id": "fixture-reviewer",
                            "version": "fixture-guidelines-1",
                            "at": "2026-10-22T00:00:00Z",
                            "method": "manual",
                            "source": "Original example"
                        }
                    ],
                    "adjudication": {
                        "status": "adjudicated",
                        "by": "fixture-adjudicator",
                        "at": "2026-10-22T00:00:00Z",
                        "rationale": "Illustrative fixture, not independent annotation evidence"
                    }
                }
            ]
        },
        {
            "id": "example-control",
            "text": "She writes.",
            "variety": "en-US",
            "split": "test",
            "groups": { "authorId": "fixture-b", "sourceId": "fixture-b", "promptId": "fixture-b" },
            "provenance": {
                "source": "Original example",
                "license": "Project-owned fixture",
                "permittedUse": ["testing"],
                "consent": "not-required"
            },
            "reviewStatus": "adjudicated",
            "validControl": true,
            "sentences": [{ "id": "s2", "start": 0, "end": 11, "text": "She writes." }],
            "errors": []
        }
    ]
}
```

`sourceId` means the underlying source family (including revisions, excerpts, and derived mutations), rather than a publisher name or a downloaded file's location. Keep true author/source/prompt grouping wherever it is available. Omitting available identifiers to obtain a favorable split invalidates the study. The leakage report also flags text duplicated across splits after NFC and whitespace normalization; this normalization is only a leakage check and never changes the original text. Missing group counts remain visible. Audit unavailable metadata and near duplicates manually before freezing the corpus.

All connected documents sharing any author, source, or prompt belong to one split. Group synthetic derivatives with their originals. Allocate groups before any training, calibration, threshold selection, rule tuning, or final test inspection. Store the locked corpus, code version, guidelines, consent/access record, and cryptographic file hashes in a restricted study manifest. Calibration and model selection use validation data; the independent test set stays sealed until the analysis plan and thresholds are frozen.

## Frozen prediction contract

This matching example can be saved as `reports/example-run.json`. It contains hand-authored fixture predictions only. Actual runs must retain their actual outputs and metadata, including abstentions, invalid spans, and unsuccessful corrections.

```json
{
    "format": "grammar-predictions",
    "id": "fixture-system-a",
    "version": "fixture-1",
    "corpusId": "original-example",
    "corpusVersion": "1",
    "kind": "full",
    "settings": { "variety": "en-US", "fixture": true },
    "omittedComponents": [],
    "documents": [
        {
            "documentId": "example-error",
            "text": "She write.",
            "predictions": [
                {
                    "id": "p1",
                    "start": 4,
                    "end": 9,
                    "original": "write",
                    "category": "Grammar",
                    "subtype": "subject-verb-agreement",
                    "confidence": 0.99,
                    "candidates": [
                        {
                            "edits": [
                                {
                                    "start": 4,
                                    "end": 9,
                                    "expected": "write",
                                    "replacement": "writes"
                                }
                            ]
                        }
                    ]
                }
            ]
        },
        { "documentId": "example-control", "text": "She writes.", "predictions": [] }
    ]
}
```

```powershell
make compare ARGS="--corpus reports/example-gold.json --run reports/example-run.json --supported Grammar --out reports/example-comparison.json"
```

This miniature example necessarily fails release-volume gates. That is the intended behavior. No accuracy numbers from it should appear in product claims.

Candidate order is the system's actual ranking. An empty candidate array is correction abstention. Edits are relative to the unchanged source document, must name their exact expected text, cannot overlap or share a start offset, and can include insertion/deletion/replacement operations. The harness applies each candidate independently, verifies exact undo, and compares the entire resulting document with each accepted gold correction. A candidate that also changes unrelated text cannot receive correction credit. Integrity checks establish mechanical source preservation, not meaning preservation; qualified blinded review remains necessary for meaning and legitimate previously unseen alternatives.

Use `kind: "baseline"` for rules-only and classical baselines, `"ablation"` for a real frozen component-removal run, and `"competitor"` for independently obtained comparator output. An ablation must name `omittedComponents`. Record actual rule/model/calibration versions, component switches, dictionary settings, style settings, variety, run environment, and timestamps in `settings`. Record actual per-document `latencyMs` and `peakMemoryBytes` only when measured with a documented method; process heap snapshots are not peak memory. Timings from different devices or instrumentation are not directly comparable.

## Annotator agreement and adjudication

Use qualified American-English annotators with written guidelines. Independently double-annotate at least 20% of the planned corpus, stratified across sources, categories, severity, dialect/variety questions, valid controls, and uncommon valid constructions. Double-annotate all contentious items. Do not present system suggestions before independent annotation. Discuss the pilot guidelines on separate material; freeze them before the held-out annotation pass.

Save independent submissions as a JSON array:

```text
[
  { "annotatorId": "reviewer-a", "documents": [
    { "documentId": "essay-id", "errors": [complete annotated-error records] },
    { "documentId": "control-id", "errors": [] }
  ] },
  { "annotatorId": "reviewer-b", "documents": [same assigned document IDs with independent records] }
]
```

Each record's `annotators` must include the submitting reviewer. Omitted documents are missing observations, not agreement on an empty label. `--annotations` validates the independent records against the same source texts and reports each reviewer pair's shared-document count, empty-document agreement, exact detection F1, preferred-correction agreement, and acceptable-alternative overlap. Cohen's kappa is calculated over the union of exact annotated spans with category/subtype label sets and an explicit empty set for an absent label. This event-based kappa has no invented token-level true negatives and must be reported alongside its universe; it is not a general token-labeling kappa. With no units, or degenerate expected agreement of one, kappa is `null`.

A third reviewer adjudicates disputed boundaries, categories, valid alternatives, and meaning preservation. Retain the original independent submissions. Use `agreed` only with at least two distinct annotators; use `adjudicated` or `rejected` with a reviewer, timestamp, and rationale. Mark each whole document `reviewStatus: "adjudicated"` after final review, including documents with no errors. Rejected labels remain auditable but are excluded from reference positives. The report lists annotation statuses and pending document IDs. Never report agreement on the adjudicated labels as if it were independent agreement.

## Metrics, uncertainty, and release decisions

Detection uses one-to-one exact UTF-16 span, category, and subtype matches. Duplicate predictions are false positives. Highest-confidence duplicates are matched first, with a stable ID tie-break; a missing confidence sorts last. The report includes overall grammatical metrics, every observed category and subtype, and a separate style report. Do not mix this strict matching score with a benchmark using a different alignment convention without also reporting that convention.

For each slice, report TP, FP, FN, precision, recall, and F0.5; top-1 correction accuracy among detected true errors (including abstentions in the denominator); top-k acceptable corrections among all gold errors and among matched errors; direct-correction precision among all predictions offering a candidate (including false positives); and the corresponding high-confidence precision measures. `sourceSpanAccuracy` is the proportion of predictions matching an intended reference span, independently of its category/subtype; `sourceSpanIntegrity` is literal source validity. Correction integrity is the fraction of candidate edit transactions that preserve their expected source and undo exactly. These denominators answer different questions and must remain visible.

Valid-control false positives are document-level rates. A valid control contains no accepted grammatical error; optional style labels/suggestions do not make it a grammatical false positive. Report all-confidence and high-confidence control rates. Calibration reports known and missing confidence counts, Brier score, ten-bin expected calibration error, and reliability bins for strict diagnostic correctness. Never invent probabilities for a competitor that does not expose them. Such predictions participate in ordinary precision/recall but cannot pass high-confidence gates. Calibration is evaluated on held-out outputs, never estimated from these test labels and rescored as if independent.

Metrics and pairwise differences use a seeded percentile bootstrap with connected author/source/prompt groups as resampling units. The same draws are paired across systems and ablations. Pairwise differences are always `right minus left`. Intervals require at least two groups and 20 defined replicates; `null` is unresolved uncertainty, not zero. Ratios with zero denominators are `null`. The report gives valid replicate counts. Sparse categories may have undefined replicates, so inspect those counts and collect more groups instead of claiming significance. Wilson 95% binomial intervals are also supplied; these assume independent outcomes and are secondary to the grouped analysis when errors cluster. Neither interval method repairs unrepresentative or leaked data. No simultaneous-inference correction is currently applied: predeclare primary comparisons, and treat exploratory category/subtype intervals accordingly.

The command applies the following **proposed, predeclared release policy** to every explicitly supported category/subtype. It is stricter than checking a favorable point estimate, and a report can certify only the declared patterns represented by the frozen corpus:

| Requirement for each declared grammatical pattern | Minimum or bound |
| --- | --- |
| Reference errors and predictions | At least 200 of each |
| Direct-correction attempts, when policy is `direct` | At least 100 |
| Valid-control documents | At least 200 |
| Independent groups containing reference errors, predictions, and controls; correction groups when applicable | At least 30 in each group cohort |
| Diagnostic precision | Wilson and group-bootstrap lower bounds at least 95% |
| Recall | Wilson and group-bootstrap lower bounds at least 90% |
| Direct-correction acceptability, when policy is `direct` | Wilson and group-bootstrap lower bounds at least 90% |
| Valid-control false-positive rate | Pattern-specific Wilson upper bound below 2% |
| Source and edit integrity | Every diagnostic has a valid literal source span; every candidate validates and undoes exactly |

Pattern gates use all diagnostics, including findings without confidence values, and, for `direct` patterns, all attempted first-choice direct corrections; this prevents a confidence cutoff from hiding low-quality findings or edits. The stricter optional category gates retain the 0.95 confidence cutoff for diagnostics and corrections and fail if any declared-category prediction has unknown confidence. Valid-control flags are counted separately for the exact category/subtype in each metric. `review` patterns are not judged on direct-correction accuracy and must not emit direct edits. Insufficient samples, unresolved bounds, or any failed requirement produce explicit failed reasons. Passing gates are engineering signals, not independent certification: consent, annotation independence, representativeness, control clustering, semantic review, browser behavior, and operational measurement still require the study record. Library callers can set alternative minimum volumes for a preregistered study; the release CLI uses the defaults above.

Disable, restrict to reviewed subtypes, or mark experimental any failing pattern. Publish all failing category/subtype results and abstention rates; an aggregate cannot hide them. Unchanged held-out data may be reused for regression only after it is no longer an independent test. A fix driven by test inspection needs a newly sealed test cohort for a new generalization claim.

## Independent blinded competitor study

1. An independent coordinator recruits or licenses a representative held-out American academic essay set, with natural errors, separately identified controlled constructions, and unusual valid English. Record genre, length, proficiency, category counts, collection dates, and exclusions. Keep synthetic and naturally occurring results distinguishable through separate frozen corpora/runs.
2. Obtain appropriate consent and assent for the participants and collection setting, including parent/guardian permission when required. Writing collection, external comparator processing, publication, and model training are separate permissions. Use pseudonymous group IDs, redact identifying content before any permitted external use, document access and retention, and honor withdrawal according to the approved study plan. Local product use is not consent for any of these uses.
3. Annotate and adjudicate the sealed gold set independently as above. Predeclare categories, cutoffs, sample volumes, primary outcomes, matching conventions, handling of abstentions/alternatives, missing data, and uncertainty analysis. Freeze rules, models, settings, and the complete evaluation script before release of the test inputs.
4. An authorized operator runs the fixed product, rules-only baseline, classical baseline, and planned component ablations on identical texts. An independent operator obtains actual comparator outputs under documented product/version/date/settings and permitted access conditions. This repository provides no external comparator caller. Preserve raw outputs and independently audited mappings to the common annotation taxonomy; do not fill absent competitor labels using this engine.
5. The coordinator assigns opaque system IDs, randomizes correction order, removes source branding, and keeps the decoding key sealed. Qualified reviewers judge grammatical validity, meaning preservation, acceptable unseen alternatives, and style status without knowing the producing system. Log disagreements and exclusions before unblinding. Any gold amendment is versioned and applied symmetrically to every system; report results before and after amendments.
6. Supply the real prediction files to the CLI. Publish category/subtype metrics, volumes, group intervals, valid controls, missing-confidence coverage, correction quality, same-device timing/memory where available, all ablation differences, exclusions, and limitations. Decode system identities only after the analysis is locked. Do not call a system superior because it produced more suggestions or because a fixture/pilot point estimate is larger.

## Consented learning study

Use a separately consented study with an approved age-appropriate protocol. Participation is voluntary and can be withdrawn without affecting tutoring or grades. Keep assessment identifiers separate from app storage and access controls. State the data collected, who can access it, retention/deletion, and any proposed publication. Never automatically add writing or learning records to model training.

Start with a feasibility pilot targeting 24 completed participants, 12 per arm, to find usability/content problems and estimate attrition. This is a proposed planning target, not a completed sample and not enough for an efficacy claim. Before a confirmatory study, an independent analyst must determine and preregister the sample size using the planned primary outcome, smallest educationally meaningful effect, expected variance, clustering, allocation, and attrition. Do not select a favorable sample size or stop early based on observed results.

Randomize participants, stratified by baseline proficiency or class where appropriate, to adaptive grammar practice or a time- and content-matched comparison. Keep tutor contact, practice time, and assessment exposure comparable. Preregister allocation concealment, missing-data rules, inclusion criteria, and analysis. Blind writing assessors and analysts to assignment whenever feasible.

Use equivalent, nonoverlapping forms for a baseline pretest, practice, immediate posttest, a delayed assessment at a predeclared interval (for example 14 days), and unfamiliar transfer passages plus an independently written essay. Hold out the transfer forms and writing prompts from exercise generation and practice. Record first attempts separately from hinted or repeated attempts, elapsed practice, hints, specific error recurrence, completion, and attrition. Do not treat repeated answers to the practiced question as transfer.

The primary endpoint should be blinded first-attempt transfer performance adjusted for baseline; secondary outcomes include retention, independently rated writing error rates, recurrence by skill, and hint dependence. Analyze the assigned groups, account for class/tutor clustering and repeated observations, report uncertainty and attrition by arm, and disclose all prespecified outcomes and deviations. Keep student identities and raw writing out of public reports. This harness scores diagnostic predictions; it does not perform this participant-level statistical analysis or establish educational effectiveness.
