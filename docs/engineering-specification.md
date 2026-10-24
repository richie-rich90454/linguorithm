# Linguorithm: Grammar Intelligence Platform

## Complete Engineering and Product Specification

**Project type:** Browser-first computational linguistics and adaptive learning platform  
**Primary language:** TypeScript  
**Model training:** Python  
**Frontend:** SolidJS + Vite  
**Package manager:** pnpm  
**Linting:** Oxlint  
**Formatting:** Oxfmt  
**Analysis runtime:** Web Workers + ONNX Runtime Web + TypeScript  
**Deployment:** GitHub Pages or Cloudflare Pages, with an optional conventional backend  
**Language scope:** American English first, architected for additional English varieties  
**AI policy:** No LLMs, generative AI APIs, or generative text-rewriting services  
**Design requirement:** Original, editorial-quality interface governed by the project's anti-slop design rules

---

# 1. Mission and engineering principles

The project is not a Grammarly clone with an educational tab. It is a grammar intelligence and learning system that helps students understand, investigate, correct, and ultimately avoid grammatical errors.

It has two primary products sharing the same linguistic engine:

1. **Essay analysis:** A student pastes an entire essay and receives contextual annotations for grammar, punctuation, spelling, usage, and optional style issues. Each finding has a location, explanation, confidence level, and proposed correction where appropriate.
2. **Grammar learning:** Students explore sentence structures, diagnose mistakes, complete multiple-choice questions, practice corrections, and receive progressively more targeted exercises based on demonstrated weaknesses.

The central engineering problem is to generalize beyond individually hard-coded mistakes without surrendering correctness to an LLM.

The solution is a hybrid architecture combining:

- Formal grammatical constraints.
- Lexical and morphological analysis.
- Compact task-specific neural models.
- Statistical contextual scoring.
- Explicit, constrained correction operations.
- Validated exercise generation.
- An adaptive learning model.
- Rigorous evaluation and regression testing.

The product should aim for world-class performance, but it must earn that claim through independent benchmarks. No architecture can guarantee that every grammatical error in every possible essay will be identified.

## 1.1 Non-negotiable constraints

- No LLMs or generative AI APIs.
- No Rust source code.
- No authored C++ or custom native compilation toolchain.
- TypeScript for the application, linguistic engine, optional server, and testable domain logic.
- Python only for offline training, corpus processing, and evaluation.
- Local-first operation with no mandatory accounts.
- Optional server-side analysis and synchronization, activated explicitly.
- American English as the initial language variety.
- Whole-essay analysis, not merely isolated sentence checking.
- Reversible, evidence-backed corrections.
- Adaptive MCQs and deterministic quiz construction from uploaded materials.
- Oxlint and Oxfmt as mandatory project-wide tooling.
- Original visual design with no generic AI-generated-dashboard aesthetic.

## 1.2 Quality principles

The product must optimize for useful, correct diagnoses rather than the raw number of highlighted words.

A system that identifies 100 errors but produces 30 false positives is not automatically better than one that identifies 80 errors with two false positives.

The system must therefore measure precision and recall separately, preserve uncertainty, and permit abstention.

The product must also distinguish grammatical correctness from stylistic preference. A short sentence, passive construction, unusual word, or unconventional but legitimate construction is not automatically an error.

---

# 2. System architecture

The application should be divided into five independently testable layers.

## 2.1 Layer A: browser application

Responsibilities:

- Essay editor and annotation interface.
- Sentence-structure workbench.
- Multiple-choice and correction exercises.
- Local document management.
- Progress visualization.
- Import and export.
- Accessibility and responsive interaction.

The UI must not contain linguistic rules or model-specific logic.

## 2.2 Layer B: domain and learning services

Responsibilities:

- Document revisions and source mapping.
- Diagnostic representation.
- Correction transactions.
- Exercise validation.
- Skill prerequisites.
- Mastery estimation.
- Review scheduling.
- Quiz assembly.

This layer should be mostly pure TypeScript, with small composable services and immutable data structures where practical.

## 2.3 Layer C: linguistic engine

Responsibilities:

- Tokenization and sentence segmentation.
- Morphology and lexical analysis.
- Part-of-speech tagging.
- Dependency parsing.
- Grammar constraint evaluation.
- Error classification.
- Candidate generation and ranking.
- Confidence calibration.
- Document-level analysis.

This is the computational core of the product.

## 2.4 Layer D: data and models

Responsibilities:

- Versioned lexical resources.
- Grammar rules.
- Annotated training data.
- Statistical language models.
- Neural model artifacts.
- Reviewed exercise corpus.
- Mutation operators.
- Benchmark and regression corpora.

All model artifacts must have explicit versions and provenance.

## 2.5 Layer E: optional server

Responsibilities:

- Deeper analysis when explicitly requested.
- Optional progress synchronization.
- Optional recovery and migration services.
- Versioned model delivery where appropriate.

The server is not required for local essay analysis or practice. The frontend must remain useful if the server is unavailable.

## 2.6 Analysis flow

The analysis pipeline is:

1. Preserve the original document and source offsets.
2. Tokenize text and segment sentences.
3. Analyze word forms, lemmas, and morphological alternatives.
4. Predict grammatical tags.
5. Build syntactic structures and retain plausible alternatives.
6. Evaluate declarative grammatical constraints.
7. Detect additional likely errors with compact classifiers.
8. Generate constrained correction candidates.
9. Rank candidates using grammar, context, and edit cost.
10. Merge redundant findings and resolve conflicts.
11. Calibrate confidence and classify diagnostic certainty.
12. Display findings with evidence and explanations.
13. Map relevant findings to learning skills.
14. Offer optional practice based on the learner's actual errors.

Every stage must expose a stable interface and be independently testable.

---

# 3. Complete technology stack

## 3.1 Application stack

| Component | Technology | Rationale |
| --- | --- | --- |
| Language | TypeScript, strict mode | Shared application and domain language |
| UI framework | SolidJS | Fine-grained reactive rendering |
| Build system | Vite | Fast development and static production builds |
| Package manager | pnpm workspaces | Consistent dependencies and monorepo management |
| Styling | Custom CSS and CSS variables | Precise visual control |
| SVGs | Original, authored SVG assets | Consistent, meaningful diagrams |
| Local database | IndexedDB | Documents, progress, model cache, and history |
| IndexedDB wrapper | Dexie | Manageable transactional persistence |
| Offline support | Service worker | Cache the application shell and approved assets |
| Background computation | Web Workers | Prevent expensive analysis from blocking the interface |
| Model interchange | ONNX | Portable inference artifacts |
| Browser inference | ONNX Runtime Web, WASM backend | Execute compact models without custom native builds |
| Optional acceleration | WebGPU | Use where supported and beneficial |
| Model training | Python and PyTorch | Train task-specific neural models |
| Classical ML | scikit-learn | Baselines, feature models, calibration, evaluation |
| Optional backend | Node.js LTS and Fastify | Conventional TypeScript server |
| Optional database | PostgreSQL | Durable server-side records when synchronization is enabled |
| Unit tests | Vitest | Test TypeScript modules |
| Property tests | fast-check | Explore broad and adversarial input spaces |
| Browser tests | Playwright | Cross-browser interaction testing |
| Accessibility tests | axe-core | Automated accessibility checks |
| Static deployment | GitHub Pages or Cloudflare Pages | Public browser access |

### Important runtime restriction

Use published ONNX Runtime Web packages and their supported runtime assets. Do not introduce a custom C++ or Rust compilation pipeline simply to run inference.

The application must include a TypeScript fallback for essential features. WebGPU is an optimization, not a requirement.

The browser application must be tested on supported versions of Chrome, Edge, Firefox, and Safari, including mobile browsers. Identical performance in every browser is not a realistic guarantee.

## 3.2 Repository layout

```text
grammar-platform/
├── apps/
│   ├── web/
│   │   ├── src/
│   │   │   ├── app/
│   │   │   ├── components/
│   │   │   ├── essay-lab/
│   │   │   ├── sentence-workbench/
│   │   │   ├── practice/
│   │   │   ├── import-export/
│   │   │   └── persistence/
│   │   └── public/
│   └── api/                         # Optional conventional backend
├── packages/
│   ├── domain/
│   ├── text/
│   ├── morphology/
│   ├── syntax/
│   ├── grammar/
│   ├── corrections/
│   ├── language-model/
│   ├── learning/
│   ├── exercises/
│   ├── material-import/
│   └── ui/
├── content/
│   ├── grammar/
│   ├── exercises/
│   ├── mutation-operators/
│   └── schemas/
├── models/
│   ├── manifests/
│   └── generated/
├── training/
│   ├── ingestion/
│   ├── datasets/
│   ├── tagger/
│   ├── parser/
│   ├── error-classifier/
│   ├── calibration/
│   └── evaluation/
├── tests/
│   ├── unit/
│   ├── property/
│   ├── regression/
│   ├── adversarial/
│   ├── benchmarks/
│   └── browser/
├── .github/
│   └── workflows/
├── oxfmt.json
├── .oxlintrc.json
├── package.json
├── pnpm-workspace.yaml
└── README.md
```

The frontend and optional backend share domain interfaces, but neither should import browser-only code into the server or server-only code into the browser.

The training environment is separate. Python produces versioned model artifacts that the TypeScript application consumes through a documented inference interface.

---

# 4. Object-oriented design

Use class-based TypeScript and composition. Avoid deep inheritance hierarchies and avoid turning every utility function into a class.

## 4.1 Domain objects

| Type                 | Responsibility                                                      |
| -------------------- | ------------------------------------------------------------------- |
| `EssayDocument`      | Original text, revisions, metadata, paragraph boundaries            |
| `Paragraph`          | Paragraph spans and document context                                |
| `Sentence`           | Sentence span, tokens, syntactic alternatives                       |
| `Token`              | Surface form, source span, lemma candidates, morphological features |
| `DependencyGraph`    | Directed grammatical relationships                                  |
| `Diagnostic`         | Error category, source span, evidence, confidence                   |
| `CorrectionProposal` | Typed edits and validated resulting text                            |
| `AnalysisReport`     | Diagnostics, model versions, limitations, processing metadata       |
| `Exercise`           | Prompt, options, answer key, skill tags, explanations               |
| `Attempt`            | Answer, correctness, hints, context, attempt number                 |
| `SkillState`         | Mastery estimate, uncertainty, review schedule                      |
| `ContentSource`      | Imported material and extraction provenance                         |

Analysis results should be immutable. A correction should create a new document revision rather than mutate the original text silently.

## 4.2 Service objects

The analysis pipeline composes services such as:

- `TextNormalizer`
- `Tokenizer`
- `SentenceSegmenter`
- `MorphologyAnalyzer`
- `PartOfSpeechTagger`
- `DependencyParser`
- `GrammarConstraintEngine`
- `ErrorClassifier`
- `CandidateGenerator`
- `CandidateRanker`
- `DiagnosticResolver`
- `FeedbackComposer`

The learning pipeline composes:

- `SkillGraph`
- `MasteryModel`
- `ReviewScheduler`
- `ExerciseSelector`
- `QuizAssembler`
- `MaterialExtractor`
- `ProgressExporter`

For example, `AnalysisPipeline` receives its parser, classifier, rule engine, and candidate ranker through constructor injection. It must not instantiate hidden implementations internally or depend on global mutable state.

Small pure functions remain appropriate for scoring, normalization, and deterministic transformations.

---

# 5. Source preservation and text representation

Source mapping must be correct before advanced grammar analysis is introduced.

Represent each token using:

\[ t_i=(s_i,e_i,w_i,\ell_i,m_i) \]

where:

- \(s_i,e_i\) are source offsets.
- \(w_i\) is the original surface form.
- \(\ell_i\) is the set of candidate lemmas.
- \(m_i\) is the set of morphological analyses.

JavaScript string offsets use UTF-16 code units. The internal mapping must therefore preserve the relationship between Unicode text, token boundaries, and browser selection APIs.

Never normalize the user's original text destructively. Maintain normalized analysis views separately from the source document.

Tokenization and ordinary sentence scanning should be linear:

\[ T(n)=O(n) \]

where \(n\) is the number of characters or tokens, depending on the operation.

Sentence segmentation must account for:

- Abbreviations and initials.
- Decimal numbers.
- Quotation marks.
- Parentheses.
- Ellipses.
- Sentence-final punctuation.
- Paragraph boundaries.
- Unusual but valid punctuation.

A period alone does not establish a sentence boundary.

Cache analysis by document revision and paragraph. When a paragraph changes, invalidate that paragraph and dependent document-level analyses instead of recomputing every unchanged paragraph.

---

# 6. Linguistic algorithms

## 6.1 Lexical and morphological analysis

Maintain a versioned lexicon containing:

- Lemmas and word forms.
- Part-of-speech possibilities.
- Inflectional paradigms.
- Frequency estimates.
- Common spelling variants.
- Proper-name and technical-term handling.
- Lexical attributes relevant to grammar constraints.

Use tries or indexed maps for lookup. A trie lookup is approximately \(O(m)\) in the queried word length \(m\).

Morphological analysis should generate possible forms rather than assuming one grammatical interpretation for each word.

For example, a word may have noun and verb interpretations. Its final interpretation depends on the surrounding syntax.

### Spelling correction

Use a SymSpell-style deletion index to retrieve candidate words, followed by weighted edit-distance ranking.

A full Damerau–Levenshtein implementation has time complexity:

\[ O(|a||b|) \]

for strings \(a\) and \(b\).

Use bounded edit distance and candidate pruning to avoid comparing every unknown word against the entire vocabulary.

A candidate score can be:

\[ S(w\mid c)= \alpha \log P_{\mathrm{lex}}(w) +\beta \log P_{\mathrm{context}}(w\mid c) -\gamma D(w,w_{\mathrm{input}}) \]

where:

- \(P_{\mathrm{lex}}\) is lexical frequency evidence.
- \(P_{\mathrm{context}}\) is a local context score.
- \(D\) is weighted edit distance.
- \(\alpha,\beta,\gamma\) are calibrated parameters.

Unknown words must not automatically be marked as misspellings. Names, technical terminology, and valid uncommon words must remain supported.

## 6.2 Part-of-speech tagging

Use a compact task-specific neural model, initially a bidirectional LSTM with character-level features and a CRF output layer.

This is a discriminative sequence-labeling model, not a generative language model.

For token representations \(h_1,\ldots,h_n\), define:

\[ \operatorname{Score}(y,x)= \sum_{i=1}^{n}\phi(y_i,h_i) +\sum_{i=2}^{n}A_{y_{i-1},y_i} \]

where \(\phi\) scores a token-tag assignment and \(A\) scores adjacent tag transitions.

Use Viterbi decoding to select the most likely tag sequence.

With \(K\) possible tags, CRF decoding costs:

\[ O(nK^2) \]

The neural encoder adds its own cost, which must be measured in the actual implementation.

## 6.3 Dependency parsing

Use a transition-based dependency parser with a bounded beam.

The parser predicts actions that connect words through grammatical relationships. Candidate actions are scored using:

- Token representations.
- Morphological features.
- POS predictions.
- Stack and buffer state.
- Existing partial dependencies.
- Local contextual features.

With sentence length \(n\), beam width \(B\), at most \(A\) candidate actions, and scoring cost \(C\), an approximate bound is:

\[ O(nBAC) \]

assuming a linear number of parser transitions.

Retain alternative parses when the input is ambiguous or malformed. A parser that always returns one structure must not be treated as certain merely because it returned a result.

Train and evaluate on both well-formed and learner-produced sentences.

## 6.4 Declarative grammar constraints

Rules operate over syntax and morphology, not arbitrary substrings.

Each rule contains:

- Stable identifier and version.
- Target grammatical relationship.
- Required structural predicates.
- Applicable exceptions.
- Violation conditions.
- Candidate repair operations.
- Evidence spans.
- Explanation identifier.
- Confidence policy.
- Regression tests.

Examples include:

- Subject–verb agreement.
- Sentence fragments and run-ons.
- Comma splices.
- Pronoun agreement and reference.
- Verb-form consistency.
- Modifier attachment.
- Parallel structure.
- Comparisons.
- Clause coordination and subordination.
- Punctuation around clauses.
- Apostrophe and quotation punctuation.
- Context-sensitive word usage.

A rule must identify the actual grammatical subject and finite verb. It must not select the nearest noun simply because it is easier to implement.

For \(R\) rules and a graph with \(V\) nodes and \(E\) edges, a naive evaluation might cost \(O(R(V+E))\). Indexing the graph by relationship type and evaluating only relevant rules can substantially reduce repeated traversal.

Explicit rules are not inherently bad. Brittle, duplicated, untested rules are bad. Formal grammar constraints are necessary for precise and explainable checks.

## 6.5 Statistical error classification

The rule engine will not cover every error construction.

Add a separate error classifier trained on annotated examples. Its features can include:

- Token and lemma identities.
- POS and morphological features.
- Dependency relations.
- Distances between related words.
- Punctuation context.
- Structural patterns.
- Rule-trigger evidence.
- Local corpus statistics.

Begin with sparse-feature logistic regression as a baseline:

\[ P(y=1\mid x)=\sigma(w^\top x+b) \]

where \(x\) is the feature vector and \(\sigma\) is the logistic function.

If a compact neural classifier materially improves held-out results, introduce it as an ONNX model.

The classifier predicts whether a candidate is likely to be erroneous. It does not generate free-form text or invent an explanation.

## 6.6 Compact statistical language model

Train a word-level \(n\)-gram model on appropriately licensed English text.

Modified Kneser–Ney smoothing is an appropriate baseline for contextual probability estimation.

Use local probability differences to help rank corrections:

\[ \Delta L= \sum_i \log P(c_i\mid w_i^{\mathrm{candidate}})
-

\sum_i \log P(c_i\mid w_i^{\mathrm{original}}) \]

Only score contexts affected by the proposed edit.

Use pruned tables and cached lookups. For a fixed-order \(n\)-gram model, scoring a sentence is approximately linear in its token count, assuming constant-time table lookups.

A low probability is not proof of ungrammaticality. Unusual but valid constructions must not be rejected solely because they are uncommon.

---

# 7. Whole-essay error detection

The system must analyze the entire essay and distinguish local errors from document-level issues.

## 7.1 Diagnostic categories

Every diagnostic belongs to a stable taxonomy.

### Grammar

- Sentence fragments.
- Run-on sentences.
- Comma splices.
- Subject–verb agreement.
- Pronoun agreement and case.
- Pronoun reference.
- Verb forms and tense consistency.
- Modifier placement.
- Parallel structure.
- Faulty comparisons.
- Clause relationships.
- Other supported grammatical constraints.

### Punctuation

- Commas.
- Semicolons.
- Colons.
- Apostrophes.
- Quotation marks.
- Introductory elements.
- Punctuation around clauses.
- Sentence boundaries.

### Spelling and usage

- Likely misspellings.
- Incorrect inflections.
- Commonly confused words.
- Context-sensitive word choices.
- Incorrect word forms.

### Optional style

- Repetition.
- Unnecessary wordiness.
- Ambiguous phrasing.
- Possible clarity issues.
- Sentence-variety observations.
- Academic-style suggestions.

Style feedback must be visually and semantically separate from grammatical errors.

## 7.2 Document-level analysis

The document pass examines:

- Pronoun antecedents in preceding sentences.
- Tense consistency across a passage.
- Repeated references to established concepts.
- Paragraph and sentence boundaries.
- Repetition and phrase reuse.
- Discourse relationships where evidence supports them.

A tense shift is not automatically wrong. Repetition is not automatically bad. Short sentences are not automatically stylistically deficient.

Every document-level finding must record the context that supports it.

## 7.3 Diagnostic confidence

Use four output classes:

1. **Confirmed error:** a supported grammatical constraint is violated.
2. **Likely error:** strong evidence supports a correction.
3. **Possible issue:** the construction deserves review, but a valid interpretation remains possible.
4. **Style suggestion:** optional editorial advice.

Do not present raw classifier scores as calibrated probabilities.

Calibrate confidence on held-out data using methods such as Platt scaling or isotonic regression. Set category-specific thresholds based on the cost of false positives.

Provide a high-coverage review mode that surfaces plausible issues and a more conservative view that prioritizes high-confidence corrections. Do not conceal uncertainty.

## 7.4 Conflict resolution

Diagnostics may overlap.

Resolve conflicts by:

1. Grouping findings that describe the same underlying cause.
2. Deduplicating equivalent explanations.
3. Preserving independent error categories.
4. Ranking mutually exclusive corrections.
5. Reanalyzing affected spans after an edit.

Do not globally remove every overlapping diagnostic. Multiple genuine issues can affect the same sentence.

---

# 8. Correction generation

The correction engine must propose bounded, explainable edits rather than rewrite entire paragraphs.

## 8.1 Typed edit operations

Use a finite set of operations:

- `KEEP`
- `INSERT`
- `DELETE`
- `REPLACE`
- `INFLECT`
- `REORDER`
- `SPLIT`
- `MERGE`

Each operation has a target span, payload, provenance, and validation result.

A proposed correction creates a new document revision. The original remains intact, and every accepted edit can be undone.

## 8.2 Candidate scoring

For original sentence \(x\) and candidate correction \(c\):

\[ S(c\mid x)= w_gG(c)+w_eE(c)+w_lL(c)-w_dD(c) \]

where:

- \(G(c)\) measures grammatical constraint satisfaction.
- \(E(c)\) represents classifier evidence.
- \(L(c)\) represents contextual plausibility.
- \(D(c)\) penalizes unnecessary edits and undesirable changes.

Tune the weights using held-out data rather than selecting them solely by intuition.

## 8.3 Bounded search

Generate candidates only for suspicious spans.

With search depth \(H\), beam width \(B\), branching factor \(A\), and bounded scoring cost \(C\), a simplified search bound is:

\[ O(HBAC) \]

Candidate scoring must not silently include unbounded parser or language-model work.

After selecting a candidate:

- Revalidate the targeted grammatical relationship.
- Check for newly introduced errors.
- Check whether unrelated text changed.
- Confirm that the intended meaning has not been unnecessarily altered.
- Preserve alternative valid corrections where appropriate.

The system should abstain when it cannot select a defensible correction.

---

# 9. Training data and model development

## 9.1 Data sources

Investigate relevant, appropriately licensed corpora, including:

- CoNLL-2014 grammatical-error correction data.
- BEA-2019 shared-task data.
- LOCNESS for native-English learner and student writing, where permitted.
- Universal Dependencies English Web Treebank for syntactic annotation.
- Appropriately licensed edited English prose.
- Consented, carefully annotated examples representative of actual tutoring needs.

These datasets serve different purposes. Syntactic annotation, learner-error annotation, and edited prose are not interchangeable.

Verify the license and redistribution terms for every dataset and model artifact. Public availability does not automatically grant unrestricted commercial or redistribution rights.

## 9.2 Annotation schema

Every annotated error should record:

- Document and sentence identifiers.
- Exact source span.
- Error category and subtype.
- Original and corrected text.
- Accepted alternative corrections.
- Relevant grammatical relationship.
- Confidence and severity.
- Whether the issue is grammatical or stylistic.
- Annotator provenance.
- Adjudication status.

Use multiple annotators on a representative subset. Measure agreement and adjudicate disagreements before using the labels for training.

## 9.3 Training pipeline

1. Ingest data into a versioned dataset registry.
2. Record provenance, licenses, and permitted use.
3. Normalize labels while preserving original source spans.
4. Split data by author, source, and prompt where possible.
5. Train tagging, parsing, and error-classification models separately.
6. Establish rule-only and classical-ML baselines.
7. Run ablation studies.
8. Calibrate thresholds on validation data.
9. Export compact neural models to ONNX.
10. Compare browser inference with Python reference inference.
11. Generate a model manifest.
12. Run regression and performance tests before release.

Use fixed seeds where practical, pinned dependencies, recorded training configurations, and reproducible packaging.

The model-training pipeline must never be part of the browser runtime.

---

# 10. Multiple-choice learning system

The learning engine must use student responses and imported materials in different but compatible ways.

## 10.1 Curriculum graph

Represent grammar skills as a directed prerequisite graph.

For example:

- Sentence completeness supports clause-boundary understanding.
- Subjects and finite verbs support agreement.
- Clause structure supports punctuation.
- Pronoun reference supports clarity and document-level editing.

An exercise can target one primary skill and several prerequisite or supporting skills.

## 10.2 Bayesian Knowledge Tracing

For each skill, maintain a mastery estimate \(L_t\).

Let:

- \(T\) be the probability of learning between attempts.
- \(S\) be the probability of slipping despite mastery.
- \(G\) be the probability of guessing correctly without mastery.

After a correct answer:

\[ P(L_t\mid C)= \frac{L_t(1-S)} {L_t(1-S)+(1-L_t)G} \]

After an incorrect answer:

\[ P(L_t\mid W)= \frac{L_tS} {L_tS+(1-L_t)(1-G)} \]

Then update for the learning transition:

\[ L_{t+1}=P(L_t\mid \mathrm{observation}) +(1-P(L_t\mid \mathrm{observation}))T \]

These estimates are model-based beliefs, not directly measured facts about a student.

Track first-attempt accuracy, hint usage, repeated attempts, difficulty, and success on unfamiliar constructions.

## 10.3 Exercise selection

Select exercises using a score such as:

\[ U(q)= a(1-M_s)+bR_q+cD_s+dP_s-eH_q \]

where:

- \(M_s\) is estimated mastery.
- \(R_q\) is review urgency.
- \(D_s\) is uncertainty about the skill.
- \(P_s\) is prerequisite importance.
- \(H_q\) penalizes recent repetition.
- The coefficients are calibrated parameters.

Use a priority queue for due reviews. A review queue with \(Q\) entries supports insertion and removal in \(O(\log Q)\).

Do not repeatedly serve nearly identical questions. Vary the sentence structures and require transfer to unfamiliar contexts.

Once sufficient response data are available, investigate item-response theory. A two-parameter logistic model can estimate item difficulty \(b_i\) and discrimination \(a_i\):

\[ P(C\mid\theta)= \frac{1}{1+\exp[-a_i(\theta-b_i)]} \]

Do not fit this model to an insufficient sample. Begin with authored difficulty levels and BKT.

---

# 11. Quiz construction from uploaded materials

The system must create quizzes from instructional materials without generating unsupported prose.

## 11.1 Supported formats

Initial support:

- TXT.
- Markdown.
- HTML.
- Text-based PDF.
- DOCX.

Later support:

- PPTX.
- XLSX.
- Scanned PDFs through optional OCR.

Use browser-compatible parsers such as PDF.js for PDFs and Mammoth for DOCX. Imported documents must be treated as data, not executed.

## 11.2 Extraction pipeline

1. Extract text and preserve available headings, lists, tables, and page references.
2. Identify key phrases using TF-IDF, RAKE-style extraction, and frequency analysis.
3. Detect explicit term–definition relationships.
4. Identify relevant grammar concepts.
5. Match concepts to reviewed curriculum entries.
6. Construct candidate questions from deterministic templates.
7. Generate plausible distractors from approved alternatives and misconception sets.
8. Validate each answer against the source and question constraints.
9. Store the source reference with the exercise.

## 11.3 Supported question types

- Cloze questions based on source sentences.
- Term–definition matching.
- Questions about grammatical concepts demonstrated in the source.
- Sentence repair based on verified grammar constraints.
- Questions about known concepts using approved examples.

Each question must have:

- A unique identifier.
- A source reference.
- One unambiguous answer, unless multiple answers are explicitly permitted.
- Tested distractors.
- An explanation.
- A grammar-skill tag.
- A difficulty level.
- Validation metadata.

If a document is poorly structured or its content cannot support reliable questions, the system should report that limitation rather than invent material.

## 11.4 Controlled grammar mutation

Use reviewed source sentences and validated mutation operators.

Possible mutations include:

- Agreement changes.
- Clause-boundary errors.
- Pronoun-form changes.
- Faulty parallel constructions.
- Modifier-placement changes.

Every generated exercise must be checked to confirm that the source is valid, the targeted mutation creates the intended error, no unrelated errors were introduced, and the correction restores the targeted constraint.

Generated candidates must pass validation before entering the approved exercise bank.

---

# 12. Local persistence and optional backend

## 12.1 Local-first behavior

Use IndexedDB, wrapped by Dexie, to store:

- Documents and revisions.
- Analysis reports.
- Exercise attempts.
- Mastery estimates.
- Review schedules.
- Preferences.
- Model versions.
- Imported learning materials, where the user chooses to retain them.

Use stable identifiers and versioned schemas. Migrate old records explicitly.

Support progress export and restore with schema validation.

Browser storage may be cleared or evicted. Do not promise permanent retention; provide straightforward export and backup.

## 12.2 Optional backend

If deeper server-side analysis or synchronization becomes useful, introduce a conventional Node.js LTS and Fastify service with PostgreSQL.

No generative model is introduced.

The backend must be disabled by default. Essay text must never be silently uploaded. Users must explicitly opt into sending a document for deeper analysis or synchronizing records.

The initial product requires no account. If synchronization is added later, a user-controlled recovery key or similarly minimal identity mechanism can be investigated.

Keep essay content separate from progress summaries. Do not retain server-side essay text longer than necessary.

---

# 13. Performance engineering

The product must be responsive because its algorithms and execution model are efficient, not because expensive work is concealed behind a loading screen.

## 13.1 Initial performance budgets

These are targets to measure, not claims about existing performance.

| Metric | Initial target |
| --- | --- |
| Initial interactive shell | Under 2 seconds on a defined modern device and connection |
| Initial JavaScript payload | Aim for 250 KB compressed or less, excluding deferred model assets |
| Warm analysis of a 2,500-word essay | Aim for 5 seconds or less at p95 on a defined modern desktop |
| Warm analysis on a representative midrange phone | Aim for 12 seconds or less at p95 |
| UI responsiveness | Editing and navigation remain responsive during analysis |
| Long documents | Bounded memory and cancellable work |
| Offline use | Cached application and previously downloaded assets remain available when browser storage permits |

Model download time must be measured separately from analysis time.

## 13.2 Optimization order

1. Load the application shell before large model assets.
2. Execute analysis in a Web Worker.
3. Cache lexical, syntactic, and candidate results by document revision.
4. Reanalyze changed paragraphs incrementally.
5. Bound candidate search and parser beam width.
6. Use typed arrays for model inputs and compact numerical representations.
7. Prune language-model tables and lexical resources according to measured impact.
8. Quantize model weights only when quality degradation remains acceptable.
9. Use WebGPU only when supported and beneficial.
10. Profile before introducing additional optimization complexity.

Measure p50 and p95 latency, cold-start latency, peak memory, model initialization, and long-document behavior.

## 13.3 Fallback behavior

If advanced model inference is unavailable, provide the supported deterministic checks and clearly state which advanced analysis capabilities are unavailable.

Never report a successful full analysis if the model failed to load.

---

# 14. Browser compatibility and deployment

Target current mainstream versions of Chrome, Edge, Firefox, and Safari on desktop and mobile.

Use:

- Standards-based TypeScript and DOM APIs.
- Web Workers.
- IndexedDB.
- Feature detection.
- ONNX Runtime Web's supported WASM runtime.
- A TypeScript fallback for essential features.
- Service-worker caching.
- Locally bundled fonts and application assets.
- Accessible keyboard interaction.

Run actual browser-engine tests. Passing Chromium tests alone does not establish Firefox or Safari compatibility.

Deploy the static application to GitHub Pages or Cloudflare Pages. Add the optional backend only when needed.

---

# 15. Mandatory Oxlint and Oxfmt tooling

Oxlint and Oxfmt are mandatory across the TypeScript application and all TypeScript packages.

Do not introduce ESLint or Prettier as competing project-wide tools.

## 15.1 Oxfmt configuration

Create `oxfmt.json` at the repository root with the user's exact configuration:

```json
{
    "$schema": "./node_modules/oxfmt/configuration_schema.json",
    "semi": true,
    "singleQuote": false,
    "tabWidth": 4,
    "useTabs": false,
    "trailingComma": "all",
    "bracketSpacing": true,
    "arrowParens": "always",
    "printWidth": 100,
    "proseWrap": "never",
    "htmlWhitespaceSensitivity": "ignore",
    "quoteProps": "as-needed",
    "jsxSingleQuote": false,
    "embeddedLanguageFormatting": "auto",
    "singleAttributePerLine": false,
    "sortPackageJson": false,
    "ignorePatterns": [
        "node_modules/",
        "dist/",
        "package-lock.json",
        "*.min.js",
        "*.min.css",
        ".DS_Store",
        "Thumbs.db",
        ".vscode/",
        ".idea/",
        "*.log",
        "*.tmp"
    ]
}
```

Preserve the configuration exactly. Do not change the formatting rules or ignore patterns.

The schema path should resolve after `oxfmt` has been installed in the repository. Verify the configuration with the installed version of the formatter.

## 15.2 Oxlint configuration

Create `.oxlintrc.json` at the root.

Use Oxlint's supported recommended correctness and TypeScript rules, and add explicit rules where they improve reliability. In particular:

- Avoid unnecessary `any`.
- Catch unused variables and imports.
- Catch unreachable code and suspicious conditions.
- Enforce reliable promise handling where supported.
- Keep TypeScript and JSX diagnostics enabled.
- Permit narrowly justified exceptions with documented reasons.
- Do not disable whole rule categories merely to make CI pass.

Validate the configuration against the installed Oxlint version. Pin the resolved package versions in `pnpm-lock.yaml`.

## 15.3 Root package scripts

Add the following scripts to the root `package.json`, preserving all existing dependencies and project metadata:

```json
{
    "scripts": {
        "lint": "oxlint .",
        "format": "oxfmt .",
        "format:check": "oxfmt --check .",
        "typecheck": "pnpm -r --if-present typecheck",
        "test": "pnpm -r --if-present test",
        "build": "pnpm -r --if-present build",
        "check": "pnpm lint && pnpm format:check && pnpm typecheck && pnpm test"
    }
}
```

Install the tooling with pnpm:

```bash
pnpm add -D oxlint oxfmt
```

Do not invent package versions. Install supported published versions, retain the lockfile, and use a pinned pnpm version through the repository's package-manager configuration.

The example scripts assume each applicable workspace defines its own `typecheck`, `test`, and `build` scripts. Add those scripts to the relevant packages.

## 15.4 Formatting policy

- Four spaces, no tabs.
- Double quotes.
- Semicolons.
- Trailing commas according to the supplied configuration.
- Maximum configured line width of 100 characters.
- No automatic `package.json` sorting.
- The exact ignore patterns specified above.
- No conflicting formatter configuration in individual packages.

Run `pnpm format` locally to format code and `pnpm format:check` in CI to verify it.

Python training code is not passed through Oxlint. Use an appropriate Python formatter and linter for that isolated environment.

---

# 16. Testing and quality assurance

## 16.1 Unit tests

Test:

- Tokenization and source spans.
- Morphological analysis.
- POS tagging interfaces.
- Dependency-graph operations.
- Grammar constraints.
- Candidate generation and ranking.
- Correction application and undo.
- Diagnostic resolution.
- Mastery updates.
- Review scheduling.
- Exercise validation.
- Import and export.

## 16.2 Property-based tests

Use fast-check to test invariants such as:

- Applying and undoing a correction restores the original text exactly.
- Every annotation maps to a valid source span.
- Unchanged document regions remain unchanged after an edit.
- A question never has an invalid or missing answer key.
- A review schedule never produces invalid dates or states.
- Malformed input cannot crash the analysis pipeline.
- Unicode text is preserved across editing and export.

## 16.3 Regression corpus

Maintain a versioned set of:

- Confirmed grammatical errors.
- Valid counterexamples.
- Ambiguous constructions.
- Accepted alternative corrections.
- Previously fixed false positives.
- Difficult sentence structures.
- Adversarial inputs.

Every rule or model change must run the full relevant regression suite.

## 16.4 Browser testing

Use Playwright to verify:

- Essay import.
- Analysis and annotation navigation.
- Editing and undo.
- Local persistence.
- Export and restore.
- Keyboard access.
- Responsive layouts.
- Offline behavior.
- Model-load failures.
- Cancellation and incremental analysis.

Run tests against Chromium, Firefox, and WebKit where supported by the test environment.

## 16.5 Privacy tests

Verify that:

- Local analysis does not make unexpected network requests.
- The application does not transmit essays in local-only mode.
- Imported content cannot execute scripts.
- Restored data is schema-validated.
- Optional synchronization requires explicit activation.
- Model artifacts have verified hashes.

---

# 17. Evaluation and measurable release gates

The quality of the engine must be established through evaluation, not architectural ambition.

## 17.1 Core metrics

For error detection:

\[ P=\frac{TP}{TP+FP} \]

\[ R=\frac{TP}{TP+FN} \]

Also measure \(F_{0.5}\), which weights precision more heavily than recall:

\[ F_{0.5}= \frac{1.25PR}{0.25P+R} \]

Report metrics separately by error category.

Additional metrics:

- Correction exact-match accuracy.
- Top-\(k\) acceptable-correction rate.
- False positives on valid control sentences.
- Confidence calibration.
- Source-span accuracy.
- Correction integrity.
- Latency and peak memory.
- Student transfer performance.

## 17.2 Proposed initial release gates

These are ambitious targets for supported categories, not claims of existing performance.

| Metric | Initial target |
| --- | --- |
| High-confidence grammatical diagnostics | At least 95% precision with sufficient test volume |
| Recall on supported categories | Aim for at least 75%, reported by category |
| Confident direct corrections | At least 90% precision |
| High-confidence false-positive rate on valid controls | Target below 2% |
| Source-span correctness | Every annotation maps to the intended original text |
| Edit integrity | Undo restores the exact original text |
| Quiz validity | Every released question has a validated answer key |
| Browser compatibility | Core workflows pass in supported engines |

If a category fails its release gate, restrict it, mark it experimental, or disable it. An aggregate score must not hide poor performance in a particular category.

## 17.3 Comparative evaluation

To establish whether the product is competitive with Grammarly:

1. Construct a held-out set of American academic essays.
2. Include naturally occurring errors and controlled error constructions.
3. Include unusual but valid English to measure false positives.
4. Have qualified annotators establish reference labels and acceptable corrections.
5. Run both systems under documented settings.
6. Compare precision, recall, correction quality, latency, and error categories.
7. Blind reviewers to the source of each correction.
8. Report sample sizes, confidence intervals, and limitations.

The number of suggestions is not a measure of quality by itself.

## 17.4 Learning evaluation

Use pretests, practice, delayed posttests, and unfamiliar transfer passages.

Measure:

- Independent first-attempt accuracy.
- Recurrence of specific errors.
- Performance after hints.
- Retention after a delay.
- Transfer to unfamiliar sentences.
- Improvement in actual writing.

A small pilot with tutees can identify usability and content problems. Strong claims about educational effectiveness require a larger and appropriately controlled evaluation.

---

# 18. Anti-slop visual design

The interface must be deliberately authored rather than assembled from a generic educational template.

## 18.1 Design constraints

- Noto Sans only.
- Pure white and black with blue and red functional accents.
- Exactly 5px radius for rounded surfaces.
- Sentence case, never all-caps UI labels.
- No muddy neutrals, beige backgrounds, decorative gradients, or glassmorphism.
- No generic card grids or stock educational illustrations.
- Original SVGs that communicate actual grammatical relationships.
- Motion only when it reveals a structural change or clarifies an interaction.
- Full keyboard accessibility and reduced-motion support.

## 18.2 Essay laboratory

The essay is the visual center.

Provide:

- A carefully typeset reading surface.
- Source-linked annotations.
- A restrained category filter.
- An explanation panel.
- Reversible correction controls.
- A clear distinction between confirmed errors and optional suggestions.

Do not bury the document beneath dashboard cards or decorative metrics.

## 18.3 Sentence workbench

Make the grammatical structure visible through:

- Clause boundaries.
- Subjects and finite verbs.
- Dependency relationships.
- Modifier attachment.
- Punctuation boundaries.
- Side-by-side comparisons of original and corrected constructions.

Diagrams must be generated from actual analysis results, not manually drawn illustrations pretending to represent the current sentence.

## 18.4 Practice interface

Every exercise should prioritize the question and the reasoning process.

Hints should become progressively more specific. Feedback should identify the relevant grammatical relationship. Follow-up exercises should test the same skill in a different construction.

Avoid public leaderboards, artificial streak pressure, decorative badges, and animations that add no instructional value.

The design process must include a mandatory anti-slop critique, rendered-interface inspection, accessibility review, and signature-preservation audit. Do not claim those reviews have passed until they have actually been performed.

---

# 19. CI/CD and release engineering

Use GitHub Actions with pinned dependency versions.

Every pull request must run:

1. Dependency installation with a frozen pnpm lockfile.
2. Oxlint.
3. Oxfmt check mode.
4. TypeScript type checking across relevant workspaces.
5. Unit and property-based tests.
6. Grammar regression tests.
7. Exercise-content validation.
8. Production build.
9. Bundle-size checks.
10. Applicable browser tests.

A formatting check must verify formatting rather than silently rewrite files.

Model training should be separate from ordinary frontend builds. A newly trained model must never replace the production model automatically without evaluation.

Every released model must have a manifest recording:

- Model version and task.
- Input and output schemas.
- Training-data provenance and permitted use.
- Training configuration and dependency versions.
- Quantization settings.
- Evaluation metrics.
- Confidence calibration.
- Supported language variety.
- Known limitations.
- Artifact hashes.

Version the application, grammar rules, model artifacts, and exercise corpus independently.

---

# 20. Security and privacy

The initial product is intended for school-age students. Privacy must be an architectural requirement.

- Local analysis is the default.
- No essay content is transmitted in local-only mode.
- No third-party analytics or remote fonts are required.
- No external model API keys are needed.
- Student writing is not used for model training without a separate, appropriate consent process.
- Imported documents are parsed as data, never executed.
- HTML imports are sanitized before rendering.
- Export files are validated before restoration.
- Optional synchronization requires explicit activation.
- Server-side retention must be documented and limited.

Browser storage is not equivalent to encrypted secure storage. If encryption is introduced, document the key-management and recovery model accurately.

---

# 21. Implementation roadmap

## Phase 0 — Foundation

Build:

- Repository and pnpm workspaces.
- TypeScript domain schemas.
- Exact Oxfmt configuration.
- Oxlint configuration.
- CI pipeline.
- Text-span infrastructure.
- Dataset manifest.
- Benchmark harness.
- Design system.

**Exit criterion:** Reproducible build, automated checks, and a fixed corpus that can be evaluated without manual intervention.

## Phase 1 — Local essay laboratory

Build:

- Text import.
- Tokenization and source mapping.
- Dictionary-based spelling checks.
- Initial deterministic grammar constraints.
- Annotation interface.
- Reversible corrections.
- IndexedDB persistence.
- Export and restore.

**Exit criterion:** Reliable source spans, intact original text, local operation, and core browser workflows passing.

## Phase 2 — Statistical syntax engine

Build:

- Morphological analysis.
- Compact POS tagger.
- Dependency parser.
- Syntactic graphs.
- Alternative-parse handling.
- Model export to ONNX.
- Browser WASM inference.

**Exit criterion:** Held-out tagging and parsing results meet predefined thresholds, and model execution does not block the interface.

## Phase 3 — Hybrid error detection

Build:

- Declarative grammar registry.
- Statistical error classifier.
- Contextual language-model scorer.
- Correction candidate generation.
- Candidate ranking.
- Confidence calibration.
- Whole-essay analysis.

**Exit criterion:** Supported categories pass their precision and recall gates and the system can abstain safely.

## Phase 4 — Grammar workbench and MCQ

Build:

- Sentence-structure visualization.
- Sentence repair.
- Error diagnosis.
- Reviewed MCQ corpus.
- Misconception-specific feedback.
- Controlled mutation operators.

**Exit criterion:** Every released exercise has a validated answer key, tested distractors, and a defensible explanation.

## Phase 5 — Adaptive learning and material import

Build:

- Curriculum prerequisite graph.
- Bayesian Knowledge Tracing.
- Review scheduler.
- Adaptive exercise selection.
- PDF, DOCX, TXT, Markdown, and HTML import.
- Deterministic quiz construction.
- Progress export and restore.

**Exit criterion:** Questions remain grounded in source material, mastery updates are validated, and transfer assessments work.

## Phase 6 — Optimization and validation

Build:

- Incremental analysis.
- Model compression.
- Performance tuning.
- Accessibility review.
- Cross-browser hardening.
- Comparative evaluation.
- Pilot learning study.
- Model cards and release documentation.

**Exit criterion:** Performance is measured on documented devices, supported categories pass their gates, and limitations are published.

Phases may overlap once interfaces are stable. Do not build a sophisticated adaptive system on unreliable diagnostics, or expand the checker before the evaluation harness is trustworthy.

---

# 22. Risk register

| Risk | Mitigation |
| --- | --- |
| Excessive false positives | Category-specific confidence thresholds and valid counterexamples |
| Weak coverage on native academic writing | Representative American-English data and targeted annotation |
| Parser failures on malformed text | Alternative parses and conservative diagnostics |
| Incorrect corrections | Bounded edits, revalidation, and correction-specific tests |
| Weak quizzes from uploaded materials | Deterministic templates, source provenance, and validation |
| Browser performance problems | Web Workers, WASM inference, incremental analysis, profiling |
| Training-data leakage | Author- and prompt-aware splits |
| Model regressions | Versioned artifacts and automated regression suites |
| Overengineering | Require measured benefit for each additional subsystem |
| Inflated claims | Category-level metrics, confidence intervals, and independent evaluation |

An algorithm belongs in the product only when it demonstrably improves accuracy, generalization, speed, memory, or learning outcomes relative to a simpler baseline.

---

# 23. Final release checklist

The product is not complete until all of these requirements have been verified.

- [ ] Essay analysis works locally without accounts or AI services.
- [ ] The application works across supported desktop and mobile browser engines.
- [ ] Whole-essay context is analyzed.
- [ ] Every diagnostic has a valid source span, category, evidence, and confidence policy.
- [ ] Corrections are reversible and preserve unrelated text.
- [ ] Valid alternative constructions are handled correctly.
- [ ] No LLMs or generative AI APIs are integrated.
- [ ] MCQs have validated answer keys and tested distractors.
- [ ] Adaptive practice uses recorded evidence of student performance.
- [ ] Uploaded-material quizzes retain source provenance.
- [ ] Precision, recall, false positives, latency, and memory are measured.
- [ ] Oxlint passes.
- [ ] Oxfmt check mode passes.
- [ ] Type checking and tests pass across applicable workspaces.
- [ ] The anti-slop design review and accessibility audit have been completed.
- [ ] Remaining limitations are documented honestly.

---

# 24. Final engineering thesis

Build a non-generative grammar intelligence engine, not a collection of isolated checks and not a generative writing assistant.

The system should combine:

1. Explicit linguistic structure.
2. Compact discriminative neural models.
3. Statistical contextual evidence.
4. Constrained correction search.
5. Confidence calibration and abstention.
6. Reproducible, validated exercises.
7. Adaptive practice based on demonstrated learning.
8. A carefully authored interface that makes grammatical reasoning visible.

Use TypeScript for the browser application and optional server, Python for offline model training, ONNX Runtime Web for supported local inference, pnpm for package management, and Oxlint plus Oxfmt for project-wide code quality. Do not introduce Rust, authored C++, or a custom native toolchain.

The goal is to make the system broad, accurate, fast, explainable, and genuinely educational. Its success will be determined by whether it catches difficult errors without inventing problems, whether its corrections preserve meaning, and whether students become better writers after using it.

**The benchmark, not the architecture diagram, determines whether it becomes world-class.** Build the evaluation harness first, establish trustworthy behavior on difficult grammatical constructions, and expand coverage without sacrificing precision.
