# Writing and model release gates

This report separates product checks that pass from accuracy goals that remain unmet. Values come from the reproducible local release run on 2026-10-24. The benchmark source is UD English EWT; it is within-corpus syntax evidence, not independent learner-writing evidence.

## Syntax improvement floor

The requested floor is at least five absolute percentage points over the stated baseline for every metric below 93% in both fixed evaluations. Other metrics must hold or improve. The direction-setting goals are 99.9999% POS and at least 93% UAS/LAS, with the one-million-token requirement for any 99.9999% POS claim. The current production candidate does not pass the five-point floor:

| Fixed evaluation | Metric | Baseline | Current production path | Change | Minimum target | Gap |
| --- | --- | --: | --: | --: | --: | --: |
| Full EWT, 1,962 sentences / 24,859 tokens | POS | 94.4728% | 94.4728% | 0.0000 pp | 94.4728% | met |
| Full EWT | UAS | 81.6565% | 81.6565% | 0.0000 pp | 86.6565% | 5.0000 pp |
| Full EWT | LAS | 77.2718% | 77.2718% | 0.0000 pp | 82.2718% | 5.0000 pp |
| Production browser, 300 sentences / 3,659 gold tokens | POS | 92.1837% | 93.4955% | +1.3118 pp | 97.1837% | 3.6882 pp |
| Production browser | UAS | 80.1585% | 81.9076% | +1.7491 pp | 85.1585% | 3.2509 pp |
| Production browser | LAS | 76.0864% | 77.8081% | +1.7217 pp | 81.0864% | 3.2783 pp |

The full EWT values above are the unchanged shipped component model evaluation. A parser checkpoint selected on the official development split previously reached full-test POS 94.4728%, UAS 82.2117%, and LAS 77.7344%; it was not promoted because the gains were below the required floor. A separate richer parser reached development UAS 82.5950% and LAS 78.3846%; a predeclared train/dev-only continuation selected epoch 25 at 82.6349% UAS and 78.4686% LAS, while epoch 30 declined. The continued parser has a different feature interface and no held-out evaluation, so it is not a release candidate. Experiment details are in the [model card](model-card.md#candidate-training-investigation-2026-10-25).

The updated browser path aligns 3,610/3,659 tokens (98.66%), exactly tokenizes 266/300 sentences, and scores 93.50%/81.91%/77.81% POS/UAS/LAS when every unmatched token counts as incorrect. The worker uses the frozen `ewt-1` model assets. The fixed 300-sentence sample was inspected during tokenizer development, so these refreshed figures are a reproducible regression measure and must not be described as an untouched confirmatory test. They do not establish independent or learner-essay performance. The original fixture, split, and accounting remain unchanged.

The fixed EWT POS result does not substantiate 99.9999% accuracy. The shipped full-set result contains 1,374 POS errors in 24,859 tokens, and the browser result contains 240 errors in 3,659 gold tokens. No independently held-out million-token test was evaluated.

## Writing-pattern gates

The product catalogs 97 general writing goals with stable IDs, learner-facing explanations and examples, proficiency bands, intent applicability, valid-control guidance, curriculum references, practice links where a matching exercise exists, and correction policies. Thirty-one are connected to at least one local detector and remain labeled `implemented-unvalidated`; 66 are `not-yet-detectable`. The plural goal uses a model-backed review rule, and a narrowly scoped gerund/infinitive review rule now links to the gerund goal. Both require stable local parse evidence and withhold automatic edits; neither has independent quality validation. These counts describe implementation availability, not quality certification. Advanced goals describe transferable writing competencies and do not introduce course-specific detector behavior. Emergent goals address written marks and text only.

No pattern has independent held-out evidence meeting the requested minimum of 95% precision, 90% recall, under 2% false positives on valid controls, and 90% acceptable direct corrections. The authored probes and controlled mutations are development evidence only. In the latest run, 26 authored clean probes had no conservative false positives and one review warning. The five authored positive skill groups detected 4/5 agreement, 3/4 verb-form, 2/4 usage, 0/1 boundary, and 0/1 pronoun examples. These small hand-authored counts cannot pass a release gate.

On 63 gold-guided EWT agreement mutations, the complete hybrid detected 47 and missed 16, with 0 target false positives on 63 source controls; classifier-only emitted findings detected 0. Source controls can contain other errors, so this is not natural-essay precision. Source-span/edit integrity passed all 411 analyzed cases and checked 219 proposals. No pattern-level correction-acceptability evidence exists.

## Product and runtime checks

The latest release workflow passes source checks, 283 engine tests, content and model-resource validation, production build, 184 Playwright tests across Chromium, Firefox, WebKit, and mobile Chromium emulation, offline checks, and the browser evaluation. Initial JavaScript is 84.1 KiB gzip across statically imported chunks against the 104.7 KiB budget. All model resources and runtime inference remain local after download; no LLM service is used. Browser coverage includes the count-noun review rule, numeric identifier and scheduled-time controls, and learner-controlled correction handling. The comparison harness now supports explicit per-pattern gates for ≥95% precision, ≥90% recall, <2% valid-control false positives, and ≥90% acceptable corrections for patterns declared direct; current evidence is still insufficient to pass those gates.

Passing product checks do not imply the unmet syntax or pattern-quality targets have passed. A release decision requiring those targets remains blocked on better held-out model results and independently annotated, genre- and proficiency-diverse writing data. The [writing progression](writing-progression.md) and [evaluation protocol](evaluation-protocol.md) describe the curriculum references and the evidence needed for those gates.
