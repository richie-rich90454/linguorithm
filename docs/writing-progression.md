# Writing progression

Linguorithm's goal map organizes writing support from emergent written expression through advanced transferable skills. It is a set of writing references, not an age, school-readiness, placement, or mastery assessment. A learner can use any goal at any stage, and the selected writing intent only filters optional guidance.

## Progression

| Stage | Focus | Reference basis |
| --- | --- | --- |
| Emergent writing | Meaningful marks, labels, names, and short written messages | Head Start Early Learning Outcomes Framework, Language and Literacy |
| Early writing | Sentence boundaries, common forms, punctuation, and simple organization | Head Start ELOF and Common Core language and writing standards |
| Elementary writing | Conventions, complete sentences, clear references, and connected ideas | Common Core language and writing standards |
| Middle and secondary writing | Sentence variety, paragraph focus, audience, purpose, and evidence | Common Core language and writing standards |
| Advanced transferable writing | Defensible claims, evidence, reasoning, synthesis, interpretation, commentary, and rhetorical choices | Common Core writing standards and transferable competencies described in public secondary writing frameworks |

Preschool coverage is limited to artifacts of written or emergent writing. The app does not assess speech, listening, developmental readiness, or a child's suitability for school. The Head Start framework itself says it is not a curriculum, assessment, or checklist; its early-literacy progression is used only as one source for age-aware goal organization.

The catalog contains 100 stable `writing.*` identifiers, learner-facing explanations, examples, control guidance, proficiency stages, intent applicability, correction policies, and links to practice where a matching skill exists. Every goal links to a local detector: 32 have a narrow diagnostic only, 67 have an optional evidence cue only, and one has both. All remain `implemented-unvalidated`; no goal is a mastery score, and no detector has independent evidence meeting the requested precision, recall, valid-control, and correction-acceptability gates. Evidence cues run only when optional style observations are enabled. They report observable text features with exact source spans and no edits; they cannot judge argument quality, source credibility, factual truth, ethics, audience fit, intent, or learner attainment. A shared practice skill does not certify every construction listed in that goal. Style preferences and deliberate choices remain separate from correctness findings.

Tests verify that all 100 catalog IDs have registered detector IDs, that every cue rule produces a source-linked review observation on its own controlled fixture, and that cue findings have no correction proposals. These implementation checks establish wiring and behavior only. Synthetic fixtures are not held-out learner writing, do not estimate precision or recall, and do not pass any independent detector quality gate. See [the detector coverage note](detector-coverage.md) for the rule boundary and current limits.

## Source mapping

- [Head Start Early Learning Outcomes Framework: Ages Birth to Five](https://headstart.gov/interactive-head-start-early-learning-outcomes-framework-ages-birth-five?redirect=eclkc) informs the emergent and early-writing progression. The framework describes development across central learning domains and cautions against using it as an assessment checklist.
- [Common Core English Language Arts: Language](https://www.thecorestandards.org/ELA-Literacy/L/) informs conventions, grammar, usage, and language progression.
- [Common Core English Language Arts: Writing](https://www.thecorestandards.org/ELA-Literacy/W/) informs writing purpose, organization, evidence, revision, and communication across grade bands.
- The College Board's public [English Language and Composition](https://apcentral.collegeboard.org/media/pdf/ap-english-language-and-composition-course-and-exam-description.pdf?course=ap-english-language-and-composition) and [English Literature and Composition](https://apcentral.collegeboard.org/media/pdf/ap-english-literature-and-composition-course-and-exam-description.pdf?course=ap-english-literature-and-composition) descriptions inform general transferable competencies such as rhetorical situation, claims, evidence, reasoning, synthesis, interpretation, and commentary. Linguorithm does not include course-specific modes, scoring, or rules.

These publications are references for organizing general writing goals. Linguorithm does not reproduce their curricula or claim endorsement, alignment certification, or educational effectiveness. Their source text remains under its respective publisher's terms; only brief descriptions and links are included here.
