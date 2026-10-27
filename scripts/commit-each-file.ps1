# Creates one Conventional Commit per eligible file. Run from any directory.
[CmdletBinding()]
param([switch]$PreviewOnly)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $projectRoot

function Invoke-Git {
    param([string[]]$Arguments)
    $output = @(& git @Arguments 2>&1)
    if ($LASTEXITCODE -ne 0) { throw "git $($Arguments -join ' ') failed: $($output -join "`n")" }
    return $output
}

# Subjects describe the responsibility of each source file, rather than merely
# repeating its filename. Content outlines below supply additional exact detail.
$purposes = @{}
@'
.editorconfig|chore|tooling|standardize editor indentation and whitespace|Establish shared editor settings so contributors produce consistent text across platforms.
.gitattributes|chore|git|normalize source line endings and identify binary assets|Keep source diffs readable while protecting model archives, fonts, and screenshots from text conversion.
.gitignore|chore|git|exclude local runtimes caches and generated resources|Keep project-contained dependencies and training outputs out of source history while retaining the frozen release bundle.
.npmrc|chore|dependencies|contain package manager state within the project|Route package stores and cache state into the workspace and disable implicit package-manager replacement.
.oxfmtrc.json|chore|format|configure consistent source formatting|Define the formatter settings used by local checks and the release workflow.
.oxlintrc.json|chore|lint|configure static analysis rules|Establish repository lint rules for application, engine, and development scripts.
oxfmt.json|chore|format|define repository formatting policy|Record the formatter configuration consumed by the project toolchain.
Makefile|build|make|add local learner-essay evaluation targets|Expose REALEC cache preparation and fixed held-out production-browser evaluation through the existing cross-platform task dispatcher.
package.json|build|workspace|declare root development tools and task scripts|Pin the workspace package manager and declare the tools required for builds, browser checks, linting, and evaluation.
pnpm-lock.yaml|build|dependencies|lock workspace dependency resolution|Record resolved dependency versions and integrity metadata for reproducible project-local installations.
pnpm-workspace.yaml|build|workspace|define package boundaries and installation policy|Connect the web application and engine packages without automatically reinstalling dependencies during tasks.
tsconfig.json|build|typescript|establish shared TypeScript compiler settings|Provide the common type-checking contract inherited by workspace packages.
playwright.config.ts|test|browser|configure cross-browser application verification|Define browser projects, test execution settings, and the application server contract used by end-to-end checks.
README.md|docs|readme|report learner-writing limits and reproducible evaluation commands|Link the independent learner-essay report, state its measured precision and recall, clarify that it does not validate individual goals, and document the two local Make targets.
LICENSE|docs|license|license project source under MIT|Record the user-selected MIT license while leaving third-party model, corpus, dictionary, and font notices separate.
CHANGELOG.md|docs|community|document the initial platform release|Describe the delivered capabilities and release scope for readers evaluating the project history.
CODE_OF_CONDUCT.md|docs|community|establish contributor conduct expectations|Define respectful participation and reporting guidance for the project community.
CONTRIBUTING.md|docs|community|explain contribution and verification workflows|Describe local setup, contribution boundaries, and checks expected before proposing changes.
SECURITY.md|docs|security|document vulnerability reporting and trust boundaries|Explain security reporting expectations and the application's handling of local documents and imported content.
SUPPORT.md|docs|community|explain support requests and diagnostic context|Help users distinguish support questions from defects and provide useful reproducible information.
apps/web/src/App.tsx|feat|a11y|announce workspace heading changes to assistive technology|Mark the current level-one workspace heading as a polite, atomic live region so screen-reader users hear the selected view after navigation; verify both the initial announcement attributes and subsequent page-heading updates in browser tests.
apps/web/src/EssayLab.tsx|feat|editor|guide revision through intent-aware local findings|Keep the familiar essay workspace while adding general writing-intent selection, optional reflection prompts, clearer finding context, explicit keep-my-wording controls, a disabled intent control until the saved draft is ready, and a clear note that unvalidated edits are reviewed and applied only by the learner.
apps/web/src/Workbench.tsx|feat|syntax|render inspectable sentence relationships|Expose token-level syntax, labeled dependency arcs, parse alternatives, and sentence inspection controls.
apps/web/src/Practice.tsx|fix|learning|ignore answer completion after the active question changes|Guard the asynchronous submission result with the original question identity so a completed write cannot mark a different question as answered or change its session feedback.
apps/web/src/Progress.tsx|feat|progress|add a transparent general writing-goal progression|Keep factual source recall separate from grammar mastery and expose the optional writing-goal map with detector status, stage filtering, and practice links.
apps/web/src/styles.css|style|web|establish the professional editorial interface|Define Noto Sans typography, restrained functional colors, responsive workspaces, accessible controls, and bounded desktop reading panes.
apps/web/src/icons.tsx|feat|web|provide a consistent interface icon vocabulary|Supply reusable vector icons for navigation and application actions within the established visual language.
apps/web/src/main.tsx|feat|web|mount the Solid application and offline integration|Connect the application entry point, global styles, and production browser lifecycle.
apps/web/src/env.d.ts|build|web|declare browser build environment types|Provide compile-time declarations needed by the Vite application and asset imports.
apps/web/src/analysis.worker.ts|feat|analysis|carry selected intent through local worker analysis|Pass typed writing intent through neural and fallback analysis paths while preserving offline model behavior, retries, report metadata, and source-linked results.
apps/web/src/local-syntax.ts|feat|models|align trained lexical vocabulary with browser tokenization|Validate model hashes and compatibility, run local inference, and pass the packaged training vocabulary to the tokenizer so lexicalized compounds retain the model's token boundaries.
apps/web/src/persistence.ts|fix|storage|preserve optional intent and deferred engine boundaries in local storage|Keep existing IndexedDB document and backup records backward compatible while importing only domain schemas and the required mastery service, avoiding an eager engine-barrel dependency.
apps/web/src/import.ts|fix|import|keep import size limits out of the eager engine bundle|Read the shared document-size bound directly from the domain module so importing supported local materials does not statically pull the complete learning engine into the initial view.
apps/web/src/office-import.ts|fix|import|keep Office import limits out of the eager engine bundle|Read the shared document-size bound directly from the domain module while preserving ordered OOXML extraction and rejecting active document content.
apps/web/src/archive-safety.ts|feat|security|bound and validate document archive expansion|Enforce ZIP entry, decompression, integrity, and path constraints before imported office content reaches application parsing.
apps/web/vite.config.ts|build|web|configure static production and offline asset delivery|Configure the Solid build and service worker resource policies for application files and verified model loading.
apps/web/index.html|feat|web|define the application document shell|Provide the static browser entry document and metadata for the local-first writing workspace.
apps/web/public/_headers|build|security|declare static hosting response protections|Record response headers expected when serving the production application through compatible static hosts.
apps/web/public/icon.svg|style|brand|provide the application vector identity|Supply a scalable project icon for browser and installed application surfaces.
apps/web/public/Noto-Sans-OFL.txt|docs|licenses|retain the Noto Sans open font license|Ship the full font notice alongside the application resources that use the typeface.
apps/web/public/licenses/noto-sans.txt|docs|licenses|retain bundled typeface attribution|Make the font licensing terms available within the distributed application license resources.
packages/engine/src/domain.ts|feat|engine|preserve complete local morphology and writing metadata|Retain optional full UD feature maps on word analyses alongside writing intent and goal coverage contracts; keep legacy document parsing and safe defaults backward compatible.
packages/engine/src/text.ts|feat|tokenizer|preserve Unicode spans and complete useful model features|Handle URLs, email addresses, dates, times, decimals, grouped numbers, initials, punctuation runs, contractions, and vocabulary-aware hyphen compounds while preserving exact UTF-16 source offsets and sentence boundaries; omit only placeholder lemmas without discarding full UD morphology.
packages/engine/src/grammar.ts|feat|grammar|detect modal-of errors before unambiguous participles|Extend contextual usage analysis to correct modal of to have when local morphology uniquely supports a participle; require an auxiliary analysis, abstain when competing adjective, finite, or nominal readings remain, retain established fallback forms, and preserve source-linked edits.
packages/engine/src/advanced-grammar.ts|fix|grammar|keep comma-splice evidence spans ordered for inverted clauses|Build evidence ranges from the minimum token start and maximum token end so inverted subject-predicate order cannot produce invalid source offsets.
packages/engine/src/spelling.ts|feat|spelling|identify unique corpus-supported word boundaries in merged tokens|Add a bounded split lookup that accepts only one segmentation supported by known words and a high-frequency function-word boundary, while abstaining on known compounds and ambiguous splits.
packages/engine/src/pipeline.ts|feat|analysis|attach intent-aware results to stable writing goals|Carry the selected writing intent into whole-document analysis, preserve traceable diagnostics, and attach typed goal coverage with current detector status and intent relevance.
packages/engine/src/hybrid.ts|feat|spelling|suggest supported spaces for already-detected merged words|For eligible lower-case tokens already considered by the local spelling pipeline, replace generic spelling feedback with one corpus-supported split, capitalize the first replacement at sentence start, retain proper-name abstention, preserve source spans, and keep the development prediction footprint at its recorded baseline.
packages/engine/src/annotations.ts|feat|evaluation|enforce per-pattern quality release gates|Add category and subtype declarations with correction policies, exact-pattern valid-control accounting, 95 percent precision and 90 percent recall bounds, direct-edit acceptability checks, unknown-confidence handling, and reproducible group-bootstrap reports.
packages/engine/src/assessment.ts|feat|assessment|record longitudinal and transfer assessment sessions|Model pre, post, delayed, and transfer evidence separately from practice mastery updates.
packages/engine/src/learning.ts|feat|learning|update skill mastery and schedule targeted review|Implement knowledge tracing, repeat-aware evidence handling, and review selection across the supported skill families.
packages/engine/src/exercises.ts|feat|practice|provide validated authored learning exercises|Define practice questions, answer keys, and explanatory feedback used by adaptive learning sessions.
packages/engine/src/mutations.ts|feat|practice|derive controlled repair questions from safe mutations|Generate bounded grammatical perturbations with validated answers and exact source restoration checks.
packages/engine/src/misconceptions.ts|feat|learning|map recurring errors to actionable misconceptions|Connect diagnostic patterns to skill-focused explanations and practice guidance.
packages/engine/src/materials.ts|feat|materials|represent imported source material and learning content|Define reusable local material structures and source references for document-derived exercises.
packages/engine/src/material-analysis.ts|feat|materials|derive learning evidence from imported text|Analyze supported material content for source-linked learning opportunities using the shared engine contracts.
packages/engine/src/statistics.ts|feat|evaluation|calculate uncertainty-aware evaluation statistics|Provide statistical summaries used to report development evidence and category-level uncertainty.
packages/engine/src/progress-export.ts|feat|progress|export portable learning records safely|Serialize progress for user-controlled transfer while guarding CSV cells against spreadsheet formula execution.
packages/engine/src/index.ts|feat|engine|export the goal catalog and traceable metadata API|Expose the stable writing-goal inventory and report annotation alongside the existing grammar, analysis, and learning services.
scripts/task.mjs|build|tasks|dispatch local REALEC ingestion and browser evaluation|Add explicit commands that use the contained Python cache and built production browser worker while refusing to run evaluation before the pinned corpus is prepared.
scripts/project-env.ps1|build|training|prepare a project-local Windows training environment|Expose the contained runtimes and cache locations needed for manual training commands without global installation.
scripts/restore-models.mjs|build|models|restore verified resources from the frozen release archive|Validate archive structure, containment, hashes, and resource limits before restoring missing or modified production model files.
scripts/package-model-release.mjs|build|models|package deterministic production model resources|Create the bounded frozen release archive and per-file integrity manifest from validated production assets.
scripts/check-model-release.mjs|test|models|verify clean restoration repair and corruption rejection|Exercise release restoration in an isolated project-local tree, including modified assets and a corrupted archive, and record stable results without leaking a random temporary-directory name into versioned evidence.
scripts/validate-models.mjs|test|models|validate model manifests resources and provenance|Check packaged resources against their declared integrity metadata and release requirements.
scripts/check-bundle.mjs|test|build|enforce the complete static entry transfer budget|Traverse the Vite manifest static-import graph from the app shell, measure project output with gzip, and reject transfer growth above the established initial-load budget while excluding deferred views and workers.
scripts/validate-content.ts|test|content|validate authored and generated practice questions|Check answer uniqueness, mutation restoration, and skill coverage before content is included in a release.
scripts/evaluate.ts|test|evaluation|evaluate grammar regression cases with uncertainty|Compute development metrics and category intervals from the checked-in regression corpus without claiming population accuracy.
scripts/compare-systems.mts|feat|evaluation|require explicit pattern declarations for release checks|Parse category and subtype support with direct or review correction policy through the Make comparison entry point, reject undeclared release gates, and report failed metrics by exact pattern.
scripts/ablate-browser.mts|test|evaluation|compare browser analysis component ablations|Measure rules-only and hybrid variants while recording source integrity and false positives on controlled cases.
scripts/benchmark.ts|perf|engine|measure local engine analysis performance|Record reproducible engine timing evidence for the documented development workload.
scripts/benchmark-browser.mjs|perf|browser|measure cold and cached browser analysis latency|Exercise actual browser inference and report workload-specific timings without substituting emulation for physical-device evidence.
reports/browser-performance.json|perf|browser|record desktop and mobile-emulated worker timings|Preserve the measured production worker startup, warm latency, DOM readiness, workload, device emulation, and memory caveats for the desktop and mobile Chromium profiles.
reports/generalization.json|test|evaluation|refresh the production worker hash for the fixed-corpus regression|Record the rebuilt local analysis worker and its SHA-256 while retaining the measured fixed-EWT syntax regression, source provenance, authored probes, source-edit integrity evidence, and the explicit limit that this browser sample was consulted during tokenizer development.
reports/secondary-ud-evaluation.json|docs|evaluation|clarify supplemental treebank holdout levels|State that Atis, CHILDES, and ESLSpok test partitions are split-held-out while CTeTex, LittlePrince, PUD, and Pronouns are fully source-held-out, and disclose that CHILDES dominates the aggregate evaluation.
reports/model-release-check.json|test|models|record frozen model restoration and corruption checks|Retain the local release-archive verification outcomes for clean restoration, repair of changed resources, and rejection of corrupt model data.
reports/performance.json|perf|engine|record reproducible local analysis timings|Preserve the runtime, synthetic workload, cold and warm engine timings, sampled process memory, and explicit limits of the local benchmark.
scripts/inspect-ui.mjs|test|interface|inspect key screens for accessibility privacy and overflow|Capture interface screenshots and check runtime errors, external requests, accessibility findings, and horizontal layout overflow.
scripts/commit-each-file.ps1|chore|git|describe contextual spelling abstention and calibration commits precisely|Record detailed per-file Conventional Commit subjects and bodies for context-supported spelling abstention, question-answer fragment controls, development-only privacy-preserving calibration bins, refreshed held-out metrics, and explicit unmet accuracy targets.
training/ingest_ewt.py|fix|training|retry pinned EWT downloads after explicit rate limits|Use immutable raw-file URLs, local hash-verified cache hits, atomic downloads, and bounded Retry-After or rate-limit-reset handling so training recovers from transient service limits without losing upstream provenance.
training/ingest_dictionary.py|fix|training|fetch licensed dictionary files through pinned raw URLs|Validate the complete dictionary manifest, use immutable raw-file URLs without GitHub API calls, verify cached bytes and sizes, and atomically retain licensed data within the project.
training/train_tagger.py|feat|training|train and export the neural part-of-speech tagger|Build the character and sequence tagging model, evaluate held-out syntax data, and export inference resources.
training/train_release.py|feat|training|train syntax models on frozen predicted tagger inputs|Train on pinned EWT and eligible English UD splits, generate parser training states with the same frozen tagger predictions used at inference, retain oracle and nonprojective counts, keep validation and test groups separate, publish per-source evidence, and save hash-verified checkpoints.
training/train_errors.py|feat|training|train and checkpoint the controlled-error classifier|Prepare features after syntax manifests are sealed using a portable one-worker default, require candidate browser parity, produce classifier resources and calibration evidence, and record checkpoint provenance without conflating synthetic tasks with natural learner errors.
training/train_ranker.py|feat|training|fit candidate correction ranking with licensed written context|Fit contextual ranking from eligible UD training splits and OANC written text, exclude exact held-out sentence overlap, and write candidate metrics separately from production evidence.
training/evaluate_baseline.py|test|training|evaluate the candidate sparse classifier reference|Record a reproducible candidate baseline for comparison with the neural classifier on the same scoped developmental task, separate from frozen production metrics.
training/evaluate_quantization.py|test|training|compare float and quantized model candidates|Measure held-out accuracy and asset sizes before any separate browser promotion decision.
training/calibrate.py|feat|training|calibrate category-specific classifier decisions|Derive threshold evidence from the recorded evaluation split and retain unavailable or unsupported category states.
training/package_models.py|build|models|package candidate inference resources with provenance|Validate pinned-source and parity evidence, package candidate models and runtime notices, and retain supplemental UD and OANC attribution without promoting an unvalidated candidate.
training/seal_manifests.py|build|models|seal model provenance before parity evidence is generated|Apply pinned provenance, dependency locks, configuration, and weight hashes to syntax manifests before classifier preparation and seal classifier metadata before browser score checks.
training/requirements.in|build|training|declare the Python model development toolchain|List the libraries required for training, evaluation, ONNX export, and Python source checks.
training/requirements.lock.txt|build|training|pin the contained Python environment dependencies|Record exact dependency versions for reproducible installation into the project-local virtual environment.
training/README.md|docs|training|document bounded development-only rule sample review|Explain how to export at most 100 short unannotated rule examples into the ignored project-local cache, state that these require human review and are not validated false positives, and retain the fixed-test limitations and target definitions.
training/datasets/ewt-manifest.json|docs|data|record the pinned EWT source and split manifest|Retain corpus revision, integrity, and split information without committing downloaded raw training data.
training/datasets/dictionary-manifest.json|docs|data|record dictionary selection provenance and integrity|Describe the selected lexical source and its reproducible ingestion metadata.
training/datasets/ud-english-manifest.json|build|datasets|clarify English UD held-out evaluation scope|State that three candidate sources provide split-held-out test partitions while four treebanks remain fully source-held-out, keeping the manifest's pinned revisions, file hashes, and per-source license rules intact.
training/datasets/oanc-manifest.json|build|datasets|pin the Open American National Corpus archive|Declare the immutable OANC GrAF source, expected byte count and digest, selected written collections, license terms, and project-local cache path for repeatable ingestion.
training/datasets/oanc-attribution.md|docs|datasets|preserve OANC archive attribution and use terms|Record the primary publisher, selected written collections, unrestricted-use statement, pinned archive digest, and the corpus's limited local-context role.
training/ud_english_sources.py|feat|training|ingest pinned supplemental UD English treebanks|Validate immutable source records and licenses, download and hash-check files into project storage, preserve source and split IDs, and keep test-only corpora out of training.
training/evaluate_ud_sources.py|test|training|label supplemental test partitions by holdout level|Report Atis, CHILDES, and ESLSpok official tests as split-held-out, identify CTeTex, LittlePrince, PUD, and Pronouns as source-held-out, disclose CHILDES aggregate dominance, and preserve gold-token metrics and evaluation provenance.
training/ingest_oanc.py|feat|training|download and verify the pinned OANC archive locally|Stream the licensed corpus into project cache with bounded retries, expected-size and SHA-256 verification, and atomic replacement only after a complete valid transfer.
training/oanc_context.py|feat|training|count context from selected OANC written texts|Read only the pinned written collections directly from the archive, process documents deterministically without extraction, and provide counts for correction-ranker features.
training/training_stats.py|feat|training|calculate descriptive token-level confidence intervals|Provide a validated Wilson interval helper for reproducible model reports and make its token-level scope explicit for clustered corpus data.
training/checkpoint_registry.py|feat|training|save hash-verified neural training checkpoints|Copy trained tensors into a versioned project directory and merge per-model details into a manifest with hashes and evaluation provenance.
training/test_ingest_ewt.py|test|training|verify EWT cache reuse and rate-limit retry behavior|Prove the downloader avoids GitHub API calls, reuses verified local bytes without network access, honors bounded retry headers for explicitly signaled rate limits, rejects hash mismatches, and installs complete downloads atomically.
training/test_ingest_dictionary.py|test|training|verify pinned dictionary ingestion and offline reuse|Check the reviewed manifest and immutable raw URLs, verify local cache hashes and byte counts without network access, reject unsafe or inconsistent provenance, and preserve complete downloads atomically.
training/test_ud_english_sources.py|test|training|verify supplemental UD source split policy|Ensure manifest hashes and licenses are checked, training splits stay separate from held-out evaluation, caches work offline, and modified source bytes are rejected.
training/test_oanc_context.py|test|training|verify OANC context selection and archive safety|Cover written-only document selection, sentence and token counts, deterministic ordering, bounded download integrity, mismatch handling, and interval calculation.
training/test_checkpoint_registry.py|test|training|verify checkpoint manifests and hash integrity|Cover checkpoint byte preservation, digest calculation, metadata merging, and rejection of invalid checkpoint sources.
models/checkpoints/README.md|docs|models|explain versioned model checkpoint contents|Document tracked checkpoint scope, SHA-256 provenance, trusted-checkout loading, and the boundary between candidate weights and the separately validated browser release.
models/checkpoints/ewt-1/manifest.json|docs|models|record checkpoint hashes and candidate evaluation|Bind each trained artifact to its byte count, SHA-256 digest, corpus manifests, training configuration, and held-out score for regression comparison.
models/checkpoints/ewt-1/tagger.pt|chore|models|retain the trained EWT part-of-speech checkpoint|Store candidate tagger weights with their content hash and fixed held-out token-accuracy evidence for reproducible comparison.
models/checkpoints/ewt-1/parser.pt|chore|models|retain the trained EWT dependency-parser checkpoint|Store candidate transition-parser weights with their hash, predicted-POS UAS/LAS evidence, and training provenance for regression comparison.
models/checkpoints/ewt-1/error-classifier.pt|chore|models|retain the controlled-error classifier checkpoint|Store review-only candidate weights with their hash and synthetic-task metrics without presenting them as independent learner-writing accuracy.
docs/dataset-expansion-research-2026-10-25.md|docs|training|record licensed English corpus expansion research|Document the official inventory, immutable source pins, license filters, training and evaluation roles, OANC context counts, and why one hundred times as many distinct English UD corpora is unavailable.
models/releases/manifest.json|build|models|declare frozen model archive and resource checksums|Record the release archive digest and individual asset hashes consumed by clean-checkout restoration.
models/releases/ewt-1.tar.gz|feat|models|ship the frozen local inference resource bundle|Include the validated production models, lexical resources, browser runtime, metadata, and required notices for offline-capable restoration.
models/manifests/registry.json|feat|models|register production syntax and classifier resources|Identify the active model manifests and policy that keeps natural-essay neural findings review-only pending independent evidence.
models/manifests/model.schema.json|feat|models|define the model metadata validation schema|Specify the integrity, provenance, capability, and metric fields expected from model manifests.
models/licenses/onnxruntime-MIT.txt|docs|licenses|retain the ONNX Runtime MIT license notice|Preserve attribution for the browser inference runtime distributed with the frozen model release.
content/regression.json|test|grammar|record controlled grammatical regression examples|Provide labeled developmental cases for checking supported diagnostic categories and clean-sentence behavior.
docs/engineering-specification.md|docs|specification|preserve the complete originating product specification|Keep the user's engineering and product requirements available as the implementation and verification reference.
docs/release-status.md|docs|release|link classifier evidence to its current model-card counts|Remove duplicated mutation totals from release status and direct readers to the model card for maintained counts, while keeping the emission gate, review-only neural behavior, and external learner-evidence gaps explicit.
docs/quickstart.md|docs|setup|document contained cross-platform Make workflows|Explain explicit dependency setup, local development, production builds, and frozen model restoration.
docs/project-containment.md|docs|setup|document project-local runtime and cache boundaries|Describe where tools, dependencies, datasets, models, and temporary state reside and how global installation is avoided.
docs/model-card.md|docs|models|report refreshed learner-writing metrics and failed accuracy goals|Publish the updated held-out confusion counts and confidence intervals after seven fewer false positives with recall unchanged, exact maximum allowed counts, failed 0.5 percent target status, and the limits on valid-control and pattern validation.
docs/research-data-models.md|docs|research|record data and model source research|Capture source selection, licensing considerations, and the evidence supporting the local inference approach.
docs/design-audit.md|docs|design|record interface decisions and visual verification|Describe the professional workspace treatment, responsive behavior, and observed interface checks.
docs/evaluation-protocol.md|docs|evaluation|define per-pattern independent accuracy and learning evaluation|Document the Make-based comparison workflow, explicit supported-pattern correction policies, per-pattern precision, recall, false-positive and correction thresholds, annotation responsibilities, and limits on independent claims.
docs/github-discovery.md|docs|community|provide accurate repository discovery and publication guidance|Supply a ready-to-use About description, relevant implementation-backed topics, a social preview asset, and a maintainer checklist for verified links, community settings, and evidence-based sharing. Leave account-level settings untouched because no remote repository is configured.
docs/images/workspace.png|docs|readme|illustrate the actual essay workspace|Provide the screenshot used to show the delivered editor and source-linked diagnostic interface.
docs/images/workbench.png|docs|readme|illustrate the actual sentence workbench|Provide the screenshot used to show token inspection and labeled dependency relationships.
docs/images/social-preview.svg|docs|brand|provide an editable repository social preview|Create a professional 1280 by 640 vector composition using the Linguorithm identity and implemented source-linked grammar workflow without fabricated adoption or accuracy claims.
docs/images/social-preview.png|docs|brand|provide a GitHub-ready repository social preview|Render the reviewed vector composition to a 1280 by 640 PNG suitable for the repository social preview setting, retaining a local editable source alongside it.
apps/web/public/.nojekyll|build|pages|serve the complete static app through GitHub Pages|Prevent Pages from treating published application resources as Jekyll input so the production asset tree remains intact.
apps/web/public/apple-touch-icon.png|style|brand|provide the iOS home-screen icon|Render the flat Linguorithm vector mark at the 180-pixel Apple touch icon size for saved home-screen use.
apps/web/public/favicon-16.png|style|brand|provide the compact browser tab icon|Render a dedicated 16-pixel fallback for browsers and surfaces that use a small raster favicon.
apps/web/public/favicon-32.png|style|brand|provide the standard browser favicon|Render a 32-pixel raster fallback that remains legible in browser tabs and bookmark lists.
apps/web/public/favicon-48.png|style|brand|provide a higher-density browser favicon|Render a 48-pixel raster fallback for browser launchers and high-density icon consumers.
apps/web/public/favicon-64.png|style|brand|provide the large browser favicon fallback|Render a 64-pixel raster fallback for platforms requesting larger legacy favicon dimensions.
apps/web/public/favicon.ico|style|brand|provide a multi-resolution legacy favicon|Package 16, 32, and 48-pixel 32-bit icon entries for browser and operating-system consumers that require ICO format.
apps/web/public/icon-192.png|style|brand|provide the installable 192-pixel app icon|Render the project mark at the 192-pixel size referenced by the web application manifest.
apps/web/public/icon-512.png|style|brand|provide the installable 512-pixel app icon|Render the project mark at the 512-pixel size referenced by the web application manifest and compatible install surfaces.
.github/workflows/deploy-pages.yml|ci|pages|publish verified static builds to GitHub Pages|Build and deploy the relative-path web application through the supported Actions deployment contract after successful verification.
content/generalization-syntax.ATTRIBUTION.md|docs|corpus|attribute the generalization syntax examples|Record dataset provenance, transformations, and attribution details for the checked-in syntax-generalization material.
content/generalization-syntax.LICENSE.txt|docs|licenses|preserve the syntax source license terms|Ship the source dataset license required for use and redistribution of the derived generalization examples.
content/generalization-syntax.json|test|corpus|add varied source-linked syntax generalization cases|Provide checked-in examples spanning tokenization, dependencies, inflection, and realistic sentence structures beyond the compact regression set.
packages/engine/src/inflections.ts|feat|morphology|derive conservative noun and verb forms from local paradigms|Use pinned lexical morphology to support count-noun checks, present agreement, unambiguous infinitive recovery, and participle identification while abstaining when corpus analyses conflict.
scripts/check-classifier-features.mjs|test|models|verify candidate browser classifier parity|Compare TypeScript runtime features and ONNX scores with sealed candidate model resources, write candidate-scoped evidence, and leave frozen-release parity reports unchanged.
scripts/evaluate-generalization.mjs|test|evaluation|measure production syntax and diagnostic generalization|Run the fixed corpus and authored challenge evaluation, retain each positive case's parse alternatives and explicit limitations, and report scoped metrics without treating development evidence as learner-population accuracy.
scripts/render-social-preview.mjs|build|brand|render cross-browser icon and repository image assets|Generate PNG, ICO, install-icon, and repository preview files from the editable SVG sources using only the project-local browser tooling.
training/ewt_splits.py|feat|training|preserve official EWT document-level split provenance|Assign reproducible source splits before training and exclude exact duplicates without implying independent author or prompt separation.
training/predicted_syntax.py|feat|training|generate contextual syntax candidates for error training|Use trained predictions to construct bounded non-hardcoded mutation candidates and preserve source metadata for evaluation.
training/test_error_mutations.py|test|training|verify contextual grammar mutation generation|Check that generated candidates preserve source offsets and grammatical contrasts across varied sentence contexts.
training/test_predicted_parser.py|test|training|verify parser training follows predicted inference inputs|Check that the parser uses frozen tagger predictions instead of oracle POS tags and records training prediction accuracy, oracle-example, and excluded nonprojective counts.
training/test_ewt_splits.py|test|training|verify reproducible corpus split boundaries|Exercise deterministic grouping, deduplication, and held-out partition invariants used by the training pipeline.
apps/web/src/WritingGoalMap.tsx|feat|goals|browse general developmental writing competencies|Render the lazy-loaded stage-filterable goal catalog with learner examples, register-aware controls, honest detector status, correction policy, and existing practice links without course-specific modes.
apps/web/src/writing-goals.css|style|goals|present the writing progression in the existing interface|Style the expandable competency map with the app’s restrained type, borders, responsive layout, and accessible controls.
packages/engine/src/goals.ts|feat|goals|catalog stable general writing goals and detector limits|Define the developmental progression, examples, controls, proficiency and intent mappings, practice links, and correction policies; derive detector status from the centralized rule registry and label unsupported or unvalidated patterns without implying completeness.
packages/engine/src/goal-metadata.ts|perf|goals|cache immutable goal metadata for clean analyses|Index emitted diagnostics by goal, reuse frozen intent-specific metadata when no findings exist, and preserve source-linked diagnostic associations while avoiding a full metadata reconstruction on clean drafts.
packages/engine/tests/advanced-coverage.test.ts|test|grammar|cover parsed verb complements and noun-number controls|Exercise the conservative enjoy-or-avoid infinitive review, accepted gerund and licensed-infinitive controls, ambiguous and quoted abstention, dependency-beam agreement, training-derived noun countability, identifier controls, and source evidence without presenting synthetic fixtures as independent accuracy evidence.
packages/engine/tests/contextual-usage-participle.test.ts|test|grammar|cover modal participle corrections and ambiguity abstention|Verify morphology-supported modal-have proposals for varied participles, source-aligned edits, competing adjective and finite readings, nominal modal words, unusable lemmas, quoted text, valid controls, and the established fallback forms.
packages/engine/tests/model-grammar-features.test.ts|test|grammar|verify corpus-derived morphology and auxiliary chains|Cover placeholder lemma handling, attested inflection alternatives, competitive parse abstention, modal base forms, valid passive participles, modal-perfect participle correction, and preserved UD feature maps.
packages/engine/tests/goals.test.ts|test|goals|verify catalog completeness and honest detector status|Check stable identifiers, required goal fields, progression, available practice, unsupported-goal labels, and correction suppression policy.
packages/engine/tests/writing-intent.test.ts|test|goals|verify backward compatibility and rule traceability|Test legacy documents, persisted intent semantics, report metadata, rule-registry integrity, accurate revision-goal scope, and links for each emitted diagnostic identifier.
tests/browser/workflows.spec.ts|test|browser|verify learner-controlled corrections and document workflows|Check that suggestions disclose their unvalidated status, analysis and dismissal preserve source text, accepted changes remain undoable, a confirmed durable save survives reload, and syntax inspection continues to work.
tests/browser/layout.spec.ts|test|a11y|verify workspace headings announce view changes|Check the essay heading's polite live-region attributes, verify that navigation updates the announced view, and retain viewport coverage for reachable desktop controls.
tests/browser/noun-number.spec.ts|test|browser|verify production count noun analysis and correction policy|Use the real packaged local models to check a singular count noun after a plural quantity, confirm the finding is review-only, prove analysis leaves the draft intact, accept a valid plural control, and abstain on a numeric identifier or scheduled time.
tests/browser/writing-intent.spec.ts|test|browser|verify writing intent and merged-word analysis in production|Exercise intent persistence, the general writing map, saved-material structure, comma-splice and valid-clause distinctions, and real production-worker analysis that offers the corpus-supported “We should” correction in Chromium, Firefox, WebKit, and mobile profiles.
tests/browser/modal-verb-forms.spec.ts|test|browser|verify local modal checks and passive controls|Use the packaged browser models to verify a corpus-attested correction after a modal, accept a valid base form, and ensure the valid passive sentence “They will be examined” receives no modal-form finding.
docs/writing-progression.md|docs|curriculum|map developmental goals to transferable writing skills|Document how Head Start, Common Core, and advanced public competency sources inform a general progression without AP product logic, speech assessment, or learner-readiness claims.
docs/detector-coverage.md|docs|goals|document detector connections and evidence limits for all 100 goals|Describe the 32 diagnostic-only, 67 cue-only, and one combined goal mappings, distinguish executable connections from independent validation, and record the held-out quality gates that remain unmet.
docs/release-gates-2026-10-24.md|docs|release|report current benchmark scores and unmet release thresholds|Compare full-EWT and production-browser scores with the requested five-point floor, explain browser-sample development exposure, record the current goal-map counts and unvalidated model-backed review rules, summarize exact-pattern release gates, and separate passing product checks from unmet accuracy targets.
reports/verification.md|docs|verification|record release status and parser beam candidate evidence|Report the final release checks, frozen metrics, hash-bound development sweep, selected beam width, fixed held-out comparison, browser performance decision, and remaining independent pattern-validation and million-token evidence gaps without presenting development scores as learner-writing proof.
packages/engine/src/goal-rules.ts|feat|goals|map merged-word spacing findings to writing goals|Associate missing-word-space findings with spacing and spelling goals so the new correction appears in the existing traceable curriculum links.
packages/engine/src/writing-goal-cues.ts|feat|goals|add focused evidence cues for connected writing goals|Implement opt-in, source-spanned surface observations for general writing goals, limit display to one cue per sentence and eight per draft, skip inline and fenced code, require separate claim and evidence terms for relevance cues, and emit no corrections or claims of quality.
packages/engine/tests/writing-goal-cues.test.ts|test|goals|verify all 100 goal links and evidence-cue safeguards|Exercise every cue fixture, stable goal and rule associations, optional display, one-cue-per-sentence and eight-per-draft limits, source spans, code exclusion with later prose, two-part evidence cues, and the absence of automatic edits.
packages/engine/tests/annotations.test.ts|test|evaluation|verify subtype quality gates and CLI declarations|Cover exact-pattern precision and recall bounds, valid-control false positives, direct versus review correction policy, unknown-confidence category handling, and validation of Make CLI declarations.
packages/engine/src/document-feedback.ts|feat|feedback|report document-level writing convention observations|Detect sentence-opening capitalization, missing terminal marks, and optional repeated inter-word spacing from parsed sentence context while respecting list markers, quotations, lower-case style, inline code, and source spans.
packages/engine/tests/tokenizer-conventions.test.ts|test|tokenizer|verify Unicode token spans and common writing conventions|Cover URL and email boundaries, decimals, dates, times, identifiers, abbreviations, punctuation runs, contractions, model-vocabulary hyphen compounds, Unicode offsets, and exact span preservation.
packages/engine/tests/writing-conventions.test.ts|test|feedback|verify document conventions and conservative controls|Exercise sentence capitalization, terminal punctuation, repeated spacing, lower-case style, headings, list markers, quotations, code spans, evidence ranges, and correction safety on parsed document text.
training/evaluate_parser_beam.py|test|training|select parser beam width with model-bound development evidence|Measure predetermined widths only on the verified EWT development split, report progress, bind the selection to model-manifest and weight hashes, and keep held-out test data out of width selection.
training/evaluate_parser_beam_test.py|test|training|evaluate the development-selected parser width on fixed EWT test data|Verify registered manifests and weight hashes, require a matching development-only selection, compute POS/UAS/LAS and token-level intervals on the pinned held-out split, compare the frozen baseline, and write an explicit no-regression report.
reports/parser-beam-candidate-evaluation.json|test|models|record the fixed held-out parser beam comparison|Capture the development-selected beam width, exact model and corpus hashes, per-token metrics and intervals, deltas against the frozen manifest, and the no-regression decision without using test results to select the width.
.github/workflows/ci.yml|ci|verification|run the contained Make verification pipeline|Define hosted checks for setup, engine validation, content, production assets, and browser behavior without claiming a hosted run has occurred.
.github/workflows/models.yml|ci|models|define explicit candidate model training and validation|Keep model candidate generation and evaluation separate from restoration of the frozen production bundle.
.github/PULL_REQUEST_TEMPLATE.md|docs|community|guide reviewable change descriptions|Ask contributors for the concrete change, validation evidence, and relevant limitations when opening a pull request.
.github/ISSUE_TEMPLATE/bug_report.yml|docs|community|collect reproducible defect reports|Structure bug reports around observed behavior, reproduction steps, and useful environment details.
.github/ISSUE_TEMPLATE/feature_request.yml|docs|community|collect actionable feature proposals|Structure proposals around the user problem, expected behavior, and project fit.
.github/ISSUE_TEMPLATE/grammar_feedback.yml|docs|community|collect reproducible grammar and practice feedback|Ask for a minimal invented sentence, expected analysis or answer, observed finding, and relevant context so language feedback can become a reviewed regression without collecting private essays.
tests/fixtures/create_fixtures.py|test|import|generate controlled office and PDF fixtures|Create reproducible local documents for import verification without relying on external user files.
tests/fixtures/blank.pdf|test|import|provide a blank PDF import fixture|Exercise handling of a valid PDF with no extractable learning text.
tests/fixtures/essay.pdf|test|import|provide a text-bearing PDF import fixture|Exercise extraction and normalization of essay text from a controlled PDF document.
tests/fixtures/essay.docx|test|import|provide a Word essay import fixture|Exercise bounded OOXML text import on a controlled local document.
docs/detector-coverage.md|docs|goals|report the external learner-writing coverage gap|Connect the 100-goal registry status to the measured REALEC token results and explain why broad corpus labels do not satisfy per-goal quality gates.
packages/engine/tests/advanced-coverage.test.ts|test|grammar|cover inverted comma-splice evidence ranges|Add a regression for a postposed second-clause subject and verify every generated evidence span is nonempty and bounded by the original source.
reports/generalization.json|test|verification|record the worker's fixed-corpus merged-word finding|Refresh the worker fingerprint and record the production correction from “thetime” to “the time” while retaining held-out syntax results, fixture limitations, and source-edit integrity evidence.
reports/realec-independent-evaluation.json|test|evaluation|refresh held-out worker fingerprint without changing measured error rates|Record the production worker filename and SHA-256 from the verified release build while preserving the fixed split counts, failed 0.5 percent target checks, and aggregate-only privacy boundary.
reports/verification.md|docs|verification|record complete release and learner-writing benchmark results|Update the verified test counts, multi-browser release checks, bundle budget, parser results, and low-recall REALEC evidence with explicit quality-gate limits.
scripts/evaluate-realec.mjs|test|evaluation|export bounded unannotated rule examples from development data|Keep fixed test evaluation as the default, restrict short rule-context exports to explicit development runs and the ignored project-local cache, cap samples at 100, project annotations and findings through evaluation tokens including insertion points, and label remaining examples as triage rather than confirmed false positives.
packages/engine/tests/hybrid-validation.test.ts|test|spelling|verify merged-word proposals preserve spans and reject risky splits|Exercise a lower-case merged-word proposal with restored sentence capitalization, assert goal links and source spans, retain the established four-letter “alot” correction, preserve proper-name abstention, and prevent a valid “forex” token from receiving a “for ex” proposal.
packages/engine/tests/spelling-generalization.test.ts|test|spelling|cover unique merged-word splits and lexical controls|Verify supported common boundaries such as “we should” and “a lot”, while rejecting known words including “therapist”, short non-function suffixes such as “ex”, and ambiguous splits.
training/datasets/realec-manifest.json|build|datasets|pin archive and prepared REALEC data checksums|Record the official archive URL and SHA-256, stable prepared-data SHA-256, CC BY-SA attribution, evaluation-only use, population, split policy, and project-local cache paths.
training/ingest_realec.py|feat|training|atomically prepare checksummed document-held REALEC annotations|Download only hash-pinned bytes, parse BRAT spans without archive extraction, validate UTF-16 source offsets and annotation surfaces, serialize stable project-local data, and preserve an existing cache when its manifest checksum does not match.
training/test_ingest_realec.py|test|training|verify checksum rejection span counts and archive safety|Prove a mismatched prepared-data digest cannot replace the prior cache; also cover provenance, stable LF serialization, discontinuous annotation spans, UTF-16 offsets, ignored POS tags, range-only annotations, bounded unique offset repair, deterministic splits, and safe archive selection.
training/README.md|docs|training|document development-only rule and spelling calibration evidence|Explain bounded unannotated-rule review and privacy-preserving spelling calibration bins, keep both in the ignored project-local cache, report refreshed fixed-test metrics, and retain the split, population, and target limitations.
reports/generalization.json|test|verification|record the refreshed production worker fingerprint|Record the worker hash from the complete release run while preserving the fixed EWT syntax scores, authored source-edit checks, and documented fixture limitations.
reports/realec-independent-evaluation.json|test|evaluation|record the held-out effect of spelling context abstention|Update the frozen worker fingerprint and report seven fewer unannotated predictions with unchanged true positives, refreshed confidence intervals, and still-failed accuracy targets while preserving aggregate-only privacy.
scripts/evaluate-realec.mjs|test|evaluation|audit spelling context bins only on development data|Keep the fixed test split as the default and unchanged in schema; compute privacy-preserving spelling calibration bins only for explicit development evaluation, using source-token overlap and packaged lexical/context resources without retaining text or IDs.
packages/engine/tests/hybrid-validation.test.ts|test|spelling|verify contextual abstention and valid discourse controls|Prove contextually implausible spelling suggestions are suppressed while supported candidates remain, preserve no-context behavior, accept a dependent clause answering a prior question, and continue flagging a standalone dependent fragment with source-aligned spans.
packages/engine/tests/realec-spelling-audit.test.ts|test|evaluation|verify private development spelling calibration bins|Check deterministic bins, one count per source token, absence of essay text and IDs, test-split exclusion, and alignment to annotation token overlap.
scripts/realec-spelling-audit.mjs|test|evaluation|summarize spelling calibration without retaining essay content|Compute development-only bins for edit distance, dictionary frequency, and contextual score gain; preserve token-overlap semantics, deterministic ordering, and content-free output.
scripts/realec-spelling-audit.d.mts|build|evaluation|type spelling calibration inputs and aggregate output|Declare readonly corpus, report, lexical-resource, and contextual-table shapes plus a privacy-preserving aggregate calibration result for the evaluation script.
README.md|docs|readme|publish updated held-out accuracy and its limits|Report frozen REALEC metrics after context-based spelling abstention, identify the seven-token false-positive reduction with unchanged recall, and keep the failed thresholds and corpus limitations explicit.
docs/detector-coverage.md|docs|goals|connect detector coverage to refreshed held-out evidence|Report the frozen 15.37 percent precision, 3.19 percent recall, 7.55 percent misclassification, and 1.24 percent false-positive rate; explain the measured spelling change and why aggregate corpus overlap does not validate individual goals.
packages/engine/src/hybrid.ts|fix|spelling|abstain when local context rejects a dictionary candidate|Compare candidate and observed two-sided context likelihood and suppress dictionary spelling proposals below the development-calibrated tenfold-loss boundary, while keeping candidates when context is absent and treating question-answer dependent clauses as complete in discourse.
scripts/commit-each-file.ps1|chore|git|describe optional style feedback and refreshed accuracy evidence|Record detailed one-file Conventional Commit subjects and bodies for pronoun-reference style gating, held-out learner-writing metrics, test-count limits, updated release evidence, and the remaining unmet accuracy goals.
packages/engine/src/advanced-grammar.ts|fix|feedback|classify pronoun ambiguity as optional style feedback|Require style-enabled analysis before emitting ambiguous pronoun-reference observations, label them as Style suggestions rather than grammar errors, preserve named-antecedent evidence, and continue offering no automatic correction.
packages/engine/tests/grammar-completion.test.ts|test|feedback|verify pronoun-reference ambiguity stays optional style feedback|Assert disabled style mode emits no pronoun-reference warning, enabled mode returns a Style suggestion with antecedent evidence and no correction across singular and plural pronoun cases.
README.md|docs|readme|publish refreshed detector evidence and remaining limits|Report the latest 184-document counts and confidence-backed rates, explain the no-recall-loss reduction in unannotated findings, and state that current evidence remains well short of the requested production accuracy.
docs/detector-coverage.md|docs|goals|report current aggregate metrics and optional style policy|Update the fixed REALEC evaluation figures, explain that pronoun ambiguity belongs to optional style feedback, and retain the distinction between corpus overlap and goal-level valid-control evidence.
docs/model-card.md|docs|models|record updated held-out feedback and detection metrics|Publish the frozen 816-finding confusion counts, Wilson and document-bootstrap intervals, the 17-finding reduction with unchanged annotated overlap, and the unmet false-positive, total-error, recall, and per-pattern quality gates.
training/README.md|docs|training|report current fixed-test results after style classification fix|Document the 15.69 percent precision, 3.19 percent recall, 7.52 percent token error, and 1.21 percent false-positive result; clarify that the 17 unannotated predictions removed by optional-style separation do not establish valid-control performance.
reports/realec-independent-evaluation.json|test|evaluation|record held-out counts after optional-style feedback separation|Bind the packaged worker hash and publish the frozen confusion counts after 17 fewer unannotated predictions with unchanged true positives, preserving Wilson intervals, bootstrap bounds, failed targets, and the aggregate-only privacy policy.
reports/generalization.json|test|verification|record final worker fingerprint and unchanged syntax scores|Capture the production worker hash from the complete release run while preserving its fixed EWT POS/UAS/LAS, source-edit integrity results, authored-case scope, and tokenizer-development exposure limitation.
reports/verification.md|docs|verification|record passing production checks and current learner-writing limits|Update the final release evidence and fixed REALEC counts after the optional style classification change; preserve exact browser, bundle, parser, corpus-scope, and unvalidated-goal limitations.
scripts/commit-each-file.ps1|chore|git|describe optional style feedback and final release evidence|Record one-file Conventional Commit messages for pronoun-reference style gating, refreshed held-out rates, current 338-engine and 200-browser release checks, the separate 58-test training run, and all remaining model-evidence limits.
reports/verification.md|docs|verification|record the final 338-test and 200-browser production release|Update the 2026-10-27 release evidence, 58 contained training tests, exact bundle and browser results, frozen model scores, optional style separation, held-out REALEC counts, and remaining accuracy and validation gaps.
docs/model-card.md|docs|models|record current held-out writing and browser evidence|Publish current learner-writing confusion counts and intervals, updated production-browser report date, the no-recall-loss reduction in unannotated findings, and explicit population, independence, and target limitations.
README.md|docs|readme|explain learner-controlled review of unvalidated essay findings|Describe the new try-first revision flow, hidden unvalidated suggestions, required meaning check, and remaining limits on independent tutoring readiness.
apps/web/src/EssayLab.tsx|feat|tutoring|gate essay revisions behind learner evidence review|Keep optional engine suggestions hidden until learners inspect the finding and attempt their own revision, require confirmation that a revealed revision preserves intended meaning before applying it, and reset each confirmation when a new analysis report arrives.
apps/web/src/styles.css|style|web|style the learner revision prompt and meaning check|Add accessible full-border treatment for the try-first review prompt and clear spacing and sizing for the meaning-preservation checkbox without altering the established visual identity.
reports/verification.md|docs|verification|record learner revision safeguards and focused browser checks|Record the 338 passing engine tests, 84.7 KiB initial bundle, 50 Chromium cases, focused WebKit and mobile passes, Firefox launch limitation, and unchanged unmet learner-writing accuracy metrics.
reports/realec-independent-evaluation.json|test|evaluation|record the latest fixed learner-writing evaluation run|Refresh the reproducible production-worker evaluation timestamp while preserving the same 184 documents, 60,825 tokens, confusion counts, confidence intervals, failed accuracy targets, and aggregate-only reporting policy.
tests/browser/helpers.ts|test|browser|share revision approval and analysis wait helpers|Provide typed Playwright helpers for explicitly revealing and confirming possible revisions and for waiting until the current analysis is complete.
tests/browser/workflows.spec.ts|test|tutoring|verify learner review gates preserve and revise the draft safely|Check that possible revisions and apply controls remain hidden before review, applying stays disabled until meaning is confirmed, accepted changes preserve undo and redo, document imports remain functional, and offline analysis completes.
tests/browser/writing-intent.spec.ts|test|grammar|verify learner review for spelling and clause-boundary suggestions|Exercise optional writing cues without corrections and confirm merged-word and comma-splice revisions stay hidden until explicit learner review and meaning confirmation.
tests/browser/layout.spec.ts|test|a11y|wait for completed analysis before responsive and accessibility checks|Use a stable application-ready signal before validating desktop control visibility, keyboard access, reduced-width layout, and screen-reader navigation.
tests/browser/learning.spec.ts|test|learning|wait for analysis before checking restored learner records|Use the completed-analysis signal while preserving assertions for local preferences, progress backup, and active-document restore behavior.
tests/browser/modal-verb-forms.spec.ts|test|grammar|expect modal revision suggestions to remain behind review|Verify the local modal-form diagnostic exposes only a hidden-until-reviewed possible revision while preserving contextual grammar behavior and correction-free valid controls.
tests/browser/models.spec.ts|test|models|wait for analysis in deterministic fallback coverage|Use the completed-analysis signal when checking explicit fallback status and local model behavior.
tests/browser/noun-number.spec.ts|test|grammar|assert tentative noun-number findings have no applicable revision|Verify the parser may explain the narrow noun-number observation without exposing an unvalidated edit.
tests/browser/office-import.spec.ts|test|security|wait for analysis before Office import safety checks|Use the completed-analysis signal to avoid coupling archive-expansion, relationship-order, and malicious-file assertions to visible essay suggestions.
tests/browser/security.spec.ts|test|security|wait for analysis before hostile document import checks|Use the completed-analysis signal while validating bounded DOCX expansion and inert HTML extraction with local-only behavior.
apps/web/src/App.tsx|fix|learning|exclude unrecognized repairs from scored mastery|Retain free-text repair attempts without inventing a selected option, exclude them from Bayesian mastery and practice attempt numbering, preserve assessment evidence, and keep legacy answer flows unchanged.
apps/web/src/Practice.tsx|fix|learning|treat unmatched repair rewrites as unscored|Distinguish accepted exact examples from other learner-written repairs, save unmatched text without a selected answer, explain the limit without declaring it wrong, and show a verified comparison example and its rule.
apps/web/src/Progress.tsx|fix|progress|separate review-required responses from scored progress|Exclude unrecognized repairs from independent-accuracy denominators, show assessment review counts, and identify pending responses without labeling them incorrect.
apps/web/src/persistence.ts|fix|storage|exclude review-required repairs from mastery replay|Keep review-required responses in local attempt history while skipping them during reconstructed grammar mastery and scored-attempt numbering.
apps/web/src/styles.css|style|practice|style the unscored repair comparison state|Use a restrained background and full borders for the local verified-example panel and review-needed feedback, preserving responsive layout and the no-accent-stripe rule.
packages/engine/src/assessment.ts|fix|assessment|exclude unrecognized repairs from assessment accuracy|Record review-required repair responses without an option index or false score, and report scored-answer totals separately from responses needing review.
packages/engine/src/domain.ts|feat|learning|preserve unscored repair review metadata|Add backward-compatible optional review status and answer indices to practice and assessment records, and reject contradictory scored records.
packages/engine/src/learning.ts|fix|learning|skip mastery updates for responses awaiting review|Return existing skill evidence unchanged when a free-text response cannot be reliably classified by its exact-answer checker.
packages/engine/src/progress-export.ts|feat|progress|export repair review status with attempts|Include the optional review-required state in portable CSV records so unmatched repairs are not misrepresented as ordinary incorrect answers.
packages/engine/tests/extended.test.ts|test|assessment|verify unrecognized repairs do not affect learning scores|Cover review-required assessment denominator exclusion without a fabricated option index and prove mastery estimates remain unchanged after an unscored repair.
packages/engine/tests/progress-export.test.ts|test|progress|verify repair review status survives CSV export|Assert portable attempt CSV contains an explicit review-required field alongside formula-safe learner progress records.
reports/verification.md|docs|verification|record repair review safety and unmet accuracy gates|Document the measured development-only REALEC results with confidence intervals, preserve fixed test results and limitations, and record the unscored repair workflow and its actual verification.
tests/browser/learning.spec.ts|test|learning|verify unmatched repair answers remain unscored|Exercise an alternate agreement rewrite through Chromium, inspect its verified comparison and rule, confirm backup persistence without an option index, and ensure it creates no mastery penalty.
scripts/commit-each-file.ps1|chore|git|describe review-required repair commits precisely|Add detailed one-file Conventional Commit messages for the unscored repair workflow, backward-compatible evidence, regression coverage, and current verification limits.
'@ -split "`n" | ForEach-Object {
    $line = $_.Trim()
    if ($line) {
        $parts = $line -split '\|', 5
        if ($parts.Count -ne 5) { throw "Invalid commit description: $line" }
        $purposes[$parts[0]] = $parts[1..4]
    }
}

function Get-CommitDescription {
    param([string]$Path)
    if ($purposes.ContainsKey($Path)) { return $purposes[$Path] }
    $name = [IO.Path]::GetFileNameWithoutExtension($Path)
    if ($Path -match '^packages/engine/tests/(.+)\.test\.ts$') {
        $area = $Matches[1] -replace '-', ' '
        return @('test', 'engine', "cover $area behavior and regressions", "Exercise $area through the public engine behavior and preserve concrete regression expectations for future changes.")
    }
    if ($Path -match '^tests/browser/(.+)\.spec\.ts$') {
        $area = $Matches[1] -replace '-', ' '
        return @('test', 'browser', "verify $area across supported browsers", "Exercise the $area application flows in real browser automation with observable interface and persistence assertions.")
    }
    if ($Path -match '^reports/interface-(.+)\.png$') {
        $area = $Matches[1] -replace '-', ' '
        return @('docs', 'verification', "capture the $area interface for visual review", "Retain the actual $area screenshot produced by local interface inspection as evidence of the rendered application.")
    }
    if ($Path -match '^reports/') {
        $area = $name -replace '-', ' '
        return @('docs', 'verification', "record $area development evidence", "Preserve the measured $area output with its recorded workload and scope; this artifact does not establish independent learner-population or physical-device claims.")
    }
    if ($Path -match '^(apps/web|packages/engine)/(package|tsconfig)\.json$') {
        $scope = if ($Matches[1] -eq 'apps/web') { 'web' } else { 'engine' }
        $kind = if ($Matches[2] -eq 'package') { 'package dependencies and task entry points' } else { 'TypeScript compiler boundaries' }
        return @('build', $scope, "configure $scope $kind", "Define the $scope $kind within the shared workspace so local tools resolve the package and check its declared interface.")
    }
    if ($Path -eq 'models/generated/.gitkeep') {
        return @('chore', 'models', 'retain the ignored generated model output directory', 'Keep the project-local candidate output location discoverable while generated exports remain ignored; versioned PyTorch checkpoints live separately in models/checkpoints.')
    }
    throw "No file-specific commit description for $Path. Add one before committing."
}

function Get-ContentOutline {
    param([string]$Path)
    $extension = [IO.Path]::GetExtension($Path).ToLowerInvariant()
    if ($extension -in @('.png', '.ico', '.gz', '.pdf', '.docx', '.woff2', '.pt')) {
        return 'Binary resource: retain original bytes without source-text conversion.'
    }
    $text = [IO.File]::ReadAllText((Join-Path $projectRoot $Path))
    $entries = @()
    if ($extension -eq '.json') {
        $parsed = ConvertFrom-Json -InputObject $text
        if ($parsed -is [array]) { $entries = @("Top-level records: $($parsed.Count)") }
        elseif ($null -ne $parsed) { $entries = @($parsed.PSObject.Properties.Name | Select-Object -First 18) }
    } elseif ($extension -eq '.md') {
        $entries = @([regex]::Matches($text, '(?m)^#{1,4}\s+(.+)$') | ForEach-Object { $_.Groups[1].Value.Trim() } | Select-Object -First 14)
    } elseif ($extension -in @('.ts', '.tsx', '.mjs', '.mts', '.py', '.ps1')) {
        $entries = @([regex]::Matches($text, '(?m)^\s*(?:(?:export|default|async|declare)\s+)*(?:function|class|interface|type|def)\s+([\w-]+)') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique | Select-Object -First 18)
        if ($Path -match '\.(test|spec)\.ts$') {
            $entries = @([regex]::Matches($text, '(?:test|it|describe)\s*\(\s*["'']([^"'']+)["'']') | ForEach-Object { $_.Groups[1].Value } | Select-Object -First 12)
        }
    }
    if ($entries.Count -gt 0) { return "Content outline: $($entries -join '; ')." }
    $lines = @($text -split '\r?\n').Count
    return "Text resource containing $lines lines; preserve its complete configuration, content, and notices."
}

# All Git mutations are performed here, in this one script. Initialization is
# intentional when the project has not previously been placed under Git.
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot '.git'))) {
    Invoke-Git -Arguments @('init', '--initial-branch=main', $projectRoot) | Write-Host
}
$actualRoot = [string](Invoke-Git -Arguments @('rev-parse', '--show-toplevel') | Select-Object -Last 1)
if ([IO.Path]::GetFullPath($actualRoot) -ne $projectRoot) { throw 'Refusing to operate on a parent repository.' }
foreach ($key in @('user.name', 'user.email')) {
    $identity = Invoke-Git -Arguments @('config', '--get', $key)
    if (-not ($identity -join '').Trim()) { throw "Configure git $key before running this script." }
}
if (@(Invoke-Git -Arguments @('diff', '--cached', '--name-only')).Count -gt 0) {
    throw 'The index already contains staged changes. Refusing to alter existing staging.'
}

$changed = @(Invoke-Git -Arguments @('-c', 'core.quotePath=false', 'ls-files', '--modified', '--deleted', '--others', '--exclude-standard') | Sort-Object -Unique)
$plans = @()
foreach ($path in $changed) {
    if ($path -match '[\r\n]' -or $path.StartsWith('"')) { throw "Unsupported filename: $path" }
    $description = @(Get-CommitDescription -Path $path)
    $fullPath = [IO.Path]::GetFullPath((Join-Path $projectRoot $path))
    if (-not $fullPath.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "File outside project: $path"
    }
    $exists = Test-Path -LiteralPath $fullPath -PathType Leaf
    $outline = if ($exists) { Get-ContentOutline -Path $path } else { 'Remove the previously tracked file from the project.' }
    $digest = if ($exists) { (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash.ToLowerInvariant() } else { 'deleted' }
    $bytes = if ($exists) { (Get-Item -LiteralPath $fullPath).Length } else { 0 }
    if ($bytes -gt 50MB) { throw "Unexpected large source artifact: $path ($bytes bytes)." }
    if ($path -match '(^|/)(\.env[^/]*|id_rsa|id_ed25519|credentials)(/|$)' -or $path -match '\.(pfx|p12|pem|key)$') {
        throw "Potential secret file requires manual review: $path"
    }
    if ($exists -and [IO.Path]::GetExtension($path) -notin @('.png', '.ico', '.gz', '.pdf', '.docx', '.woff2')) {
        $sourceText = [IO.File]::ReadAllText($fullPath)
        if ($sourceText -match '-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bAKIA[A-Z0-9]{16}\b') {
            throw "Potential embedded credential requires manual review: $path"
        }
    }
    $message = "$($description[0])($($description[1])): $($description[2])`n`n$($description[3])`n`nFile: $path`n`n$outline`n`nSnapshot: $bytes bytes; SHA-256 $digest.`n`nCommit boundary: this commit intentionally contains only this file, as requested. Dependencies and companion files are introduced in separate commits; intermediate commits are not asserted to build independently. Recorded test results describe their stated runs and are not new verification performed by this commit script.`n"
    $plans += [pscustomobject]@{ Path = $path; Digest = $digest; Message = $message }
}

$logDirectory = Join-Path $projectRoot '.cache/commit-each-file'
[IO.Directory]::CreateDirectory($logDirectory) | Out-Null
$messagePath = Join-Path $logDirectory 'message.txt'
$logPath = Join-Path $logDirectory ("commits-{0}.json" -f [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ'))
$records = [Collections.Generic.List[object]]::new()
$utf8 = [Text.UTF8Encoding]::new($false)
Write-Host "Preflight complete: $($plans.Count) files, one commit per file."
if ($PreviewOnly) {
    foreach ($plan in $plans) {
        $description = @(Get-CommitDescription -Path $plan.Path)
        $bytes = if ($plan.Digest -eq 'deleted') { 0 } else { (Get-Item -LiteralPath (Join-Path $projectRoot $plan.Path)).Length }
        Write-Host "PREVIEW $($description[0])($($description[1])): $($description[2]) | $($plan.Path) | $bytes bytes | SHA-256 $($plan.Digest)"
    }
    Write-Host 'Preview complete: no files staged and no commits created.'
    return
}
foreach ($plan in $plans) {
    if ($plan.Digest -ne 'deleted') {
        $currentDigest = (Get-FileHash -LiteralPath (Join-Path $projectRoot $plan.Path) -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($currentDigest -ne $plan.Digest) { throw "File changed after preflight: $($plan.Path). Rerun after other writers stop." }
    }
    Invoke-Git -Arguments @('add', '--all', '--', $plan.Path) | Out-Null
    $staged = @(Invoke-Git -Arguments @('-c', 'core.quotePath=false', 'diff', '--cached', '--name-only'))
    if ($staged.Count -ne 1 -or $staged[0] -ne $plan.Path) { throw "Expected only $($plan.Path) in the index; found $($staged -join ', ')." }
    [IO.File]::WriteAllText($messagePath, $plan.Message, $utf8)
    Invoke-Git -Arguments @('commit', '--file', $messagePath) | Out-Null
    $commit = [string](Invoke-Git -Arguments @('rev-parse', 'HEAD') | Select-Object -Last 1)
    $committed = @(Invoke-Git -Arguments @('-c', 'core.quotePath=false', 'diff-tree', '--root', '--no-commit-id', '--name-only', '-r', 'HEAD'))
    if ($committed.Count -ne 1 -or $committed[0] -ne $plan.Path) { throw "Unexpected commit boundary at $commit." }
    $records.Add([pscustomobject]@{ commit = $commit; file = $plan.Path; sha256 = $plan.Digest })
    [IO.File]::WriteAllText($logPath, (ConvertTo-Json -InputObject @($records.ToArray()) -Depth 4), $utf8)
    Write-Host "[$($records.Count)/$($plans.Count)] $($commit.Substring(0, 12)) $($plan.Path)"
}
$remaining = @(Invoke-Git -Arguments @('status', '--porcelain=v1', '--untracked-files=all'))
if ($remaining.Count -gt 0) { throw "Files remain after committing: $($remaining -join "`n")" }
Write-Host "Complete: $($records.Count) single-file Conventional Commits. Working tree clean. Audit log: $logPath"
