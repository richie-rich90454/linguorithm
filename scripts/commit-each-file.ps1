# Creates one Conventional Commit per eligible file. Run from any directory.
[CmdletBinding()]
param()

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
Makefile|build|make|provide cross-platform project and release targets|Expose explicit development, installation, training, evaluation, model-beam experiments, and release commands through GNU Make.
package.json|build|workspace|declare root development tools and task scripts|Pin the workspace package manager and declare the tools required for builds, browser checks, linting, and evaluation.
pnpm-lock.yaml|build|dependencies|lock workspace dependency resolution|Record resolved dependency versions and integrity metadata for reproducible project-local installations.
pnpm-workspace.yaml|build|workspace|define package boundaries and installation policy|Connect the web application and engine packages without automatically reinstalling dependencies during tasks.
tsconfig.json|build|typescript|establish shared TypeScript compiler settings|Provide the common type-checking contract inherited by workspace packages.
playwright.config.ts|test|browser|configure cross-browser application verification|Define browser projects, test execution settings, and the application server contract used by end-to-end checks.
README.md|docs|readme|introduce Linguorithm with honest capabilities and contributor paths|Present the local writing workflow, explain the intent lens and general goal progression, link provenance and release evidence, document current detector and validation limits, and invite reproducible language feedback without fabricated badges or unsupported accuracy claims.
LICENSE|docs|license|license project source under MIT|Record the user-selected MIT license while leaving third-party model, corpus, dictionary, and font notices separate.
CHANGELOG.md|docs|community|document the initial platform release|Describe the delivered capabilities and release scope for readers evaluating the project history.
CODE_OF_CONDUCT.md|docs|community|establish contributor conduct expectations|Define respectful participation and reporting guidance for the project community.
CONTRIBUTING.md|docs|community|explain contribution and verification workflows|Describe local setup, contribution boundaries, and checks expected before proposing changes.
SECURITY.md|docs|security|document vulnerability reporting and trust boundaries|Explain security reporting expectations and the application's handling of local documents and imported content.
SUPPORT.md|docs|community|explain support requests and diagnostic context|Help users distinguish support questions from defects and provide useful reproducible information.
apps/web/src/App.tsx|feat|web|add general writing intent and defer secondary workspace services|Persist the selected writing intent with each draft and analysis; keep learning and material services behind their views and actions to protect the initial bundle; render saved material analysis reactively after its deferred engine loads; preserve navigation state, imports, corrections, and progress workflows.
apps/web/src/EssayLab.tsx|feat|editor|guide revision through intent-aware local findings|Keep the familiar essay workspace while adding general writing-intent selection, optional reflection prompts, clearer finding context, explicit keep-my-wording controls, and a disabled intent control until the saved draft is ready.
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
packages/engine/src/domain.ts|feat|engine|define writing intent and goal metadata contracts|Add the general learner-selected intent type and optional report coverage metadata; preserve legacy document parsing, safe defaults, stable text revisions, and typed local analysis interfaces.
packages/engine/src/text.ts|feat|tokenizer|preserve Unicode spans and improve corpus token conventions|Handle URLs, email addresses, dates, times, decimals, grouped numbers, initials, punctuation runs, and vocabulary-aware hyphen compounds while preserving exact UTF-16 source offsets and sentence boundaries.
packages/engine/src/grammar.ts|feat|grammar|detect bounded grammatical patterns and propose repairs|Provide deterministic grammar diagnostics with explicit evidence and source-checked correction edits, including narrowly scoped missing-apostrophe recovery for common unambiguous contractions.
packages/engine/src/advanced-grammar.ts|feat|grammar|detect parsed clause boundaries and list punctuation|Use stable neural subject and predicate evidence to identify comma splices across subjects beyond personal pronouns, retain coordination and subordinate-clause controls, and inspect stable noun-series parses for missing internal commas.
packages/engine/src/spelling.ts|feat|spelling|retrieve bounded dictionary correction candidates|Implement spelling candidate search and edit-distance behavior for local lexical diagnostics.
packages/engine/src/pipeline.ts|feat|analysis|attach intent-aware results to stable writing goals|Carry the selected writing intent into whole-document analysis, preserve traceable diagnostics, and attach typed goal coverage with current detector status and intent relevance.
packages/engine/src/hybrid.ts|fix|analysis|reject corrections that introduce new supported findings|Revalidate fallback, parsed-rule, and spelling proposals against deterministic constraints, reparsed dependencies, and contextual classifier findings. Match findings through edit-mapped source spans to catch equal-count relocation, retain complete lexical candidates above the neural token limit, and reuse bounded syntax caches for equivalent repairs.
packages/engine/src/annotations.ts|feat|annotations|validate and preserve source-linked annotation data|Define annotation processing that retains document positions and checks imported evidence before it is used.
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
scripts/task.mjs|build|make|dispatch tasks with project-contained runtime state|Run explicit tool entry points with argument arrays, local caches, and platform-aware runtime selection behind Make targets.
scripts/project-env.ps1|build|training|prepare a project-local Windows training environment|Expose the contained runtimes and cache locations needed for manual training commands without global installation.
scripts/restore-models.mjs|build|models|restore verified resources from the frozen release archive|Validate archive structure, containment, hashes, and resource limits before restoring missing or modified production model files.
scripts/package-model-release.mjs|build|models|package deterministic production model resources|Create the bounded frozen release archive and per-file integrity manifest from validated production assets.
scripts/check-model-release.mjs|test|models|verify clean restoration repair and corruption rejection|Exercise release restoration in an isolated project-local tree, including modified assets and a corrupted archive, and record stable results without leaking a random temporary-directory name into versioned evidence.
scripts/validate-models.mjs|test|models|validate model manifests resources and provenance|Check packaged resources against their declared integrity metadata and release requirements.
scripts/check-bundle.mjs|test|build|enforce the complete static entry transfer budget|Traverse the Vite manifest static-import graph from the app shell, measure project output with gzip, and reject transfer growth above the established initial-load budget while excluding deferred views and workers.
scripts/validate-content.ts|test|content|validate authored and generated practice questions|Check answer uniqueness, mutation restoration, and skill coverage before content is included in a release.
scripts/evaluate.ts|test|evaluation|evaluate grammar regression cases with uncertainty|Compute development metrics and category intervals from the checked-in regression corpus without claiming population accuracy.
scripts/compare-systems.mts|test|evaluation|support reproducible system comparison inputs|Provide comparison tooling for independently supplied system results and the documented evaluation protocol.
scripts/ablate-browser.mts|test|evaluation|compare browser analysis component ablations|Measure rules-only and hybrid variants while recording source integrity and false positives on controlled cases.
scripts/benchmark.ts|perf|engine|measure local engine analysis performance|Record reproducible engine timing evidence for the documented development workload.
scripts/benchmark-browser.mjs|perf|browser|measure cold and cached browser analysis latency|Exercise actual browser inference and report workload-specific timings without substituting emulation for physical-device evidence.
reports/browser-performance.json|perf|browser|record desktop and mobile-emulated worker timings|Preserve the measured production worker startup, warm latency, DOM readiness, workload, device emulation, and memory caveats for the desktop and mobile Chromium profiles.
reports/generalization.json|test|evaluation|record the current fixed-corpus production-path regression|Preserve the actual production worker hash, refreshed tokenization and syntax metrics, source provenance, authored-probe counts, edit integrity, and the limitation that the browser sample was consulted during tokenizer development.
reports/model-release-check.json|test|models|record frozen model restoration and corruption checks|Retain the local release-archive verification outcomes for clean restoration, repair of changed resources, and rejection of corrupt model data.
reports/performance.json|perf|engine|record reproducible local analysis timings|Preserve the runtime, synthetic workload, cold and warm engine timings, sampled process memory, and explicit limits of the local benchmark.
scripts/inspect-ui.mjs|test|interface|inspect key screens for accessibility privacy and overflow|Capture interface screenshots and check runtime errors, external requests, accessibility findings, and horizontal layout overflow.
scripts/commit-each-file.ps1|chore|git|create detailed conventional commits one file at a time|Implement the requested single-script commit workflow with preflight checks, file-specific messages, isolated staging, and post-commit verification.
training/ingest_ewt.py|feat|training|ingest pinned EWT syntax data with split provenance|Prepare reproducible corpus splits and record upstream licensing and source integrity for supervised syntax training.
training/ingest_dictionary.py|feat|training|ingest the licensed local spelling dictionary|Expand the selected dictionary resources and preserve their upstream provenance and licensing metadata.
training/train_tagger.py|feat|training|train and export the neural part-of-speech tagger|Build the character and sequence tagging model, evaluate held-out syntax data, and export inference resources.
training/train_release.py|feat|training|train the transition-based dependency parser|Train the parser on the recorded corpus split and export the resources required for local sentence structure analysis.
training/train_errors.py|feat|training|train the contextual error classifier on controlled mutations|Produce classifier resources and calibration evidence while retaining the distinction between synthetic tasks and natural learner errors.
training/train_ranker.py|feat|training|train contextual correction ranking resources|Fit the bounded correction ranker and language-model features on controlled source-derived examples.
training/evaluate_baseline.py|test|training|evaluate a sparse classifier reference baseline|Record a reproducible baseline for comparison with the neural classifier on the same scoped developmental task.
training/evaluate_quantization.py|test|training|compare float and quantized model candidates|Measure held-out accuracy and asset sizes before any separate browser promotion decision.
training/calibrate.py|feat|training|calibrate category-specific classifier decisions|Derive threshold evidence from the recorded evaluation split and retain unavailable or unsupported category states.
training/package_models.py|build|models|package inference resources with full attribution|Validate inputs and export production models, metadata, dictionary resources, and runtime license notices.
training/seal_manifests.py|build|models|seal accurate training provenance and integrity metadata|Preserve actual training settings and dependency versions while recording hashes for exported resources.
training/requirements.in|build|training|declare the Python model development toolchain|List the libraries required for training, evaluation, ONNX export, and Python source checks.
training/requirements.lock.txt|build|training|pin the contained Python environment dependencies|Record exact dependency versions for reproducible installation into the project-local virtual environment.
training/README.md|docs|training|document reproducible local model development and evaluation|Explain project-contained data and runtimes, the GNU Make training and packaging workflow, current fixed browser scores, and why those within-corpus results do not establish independent learner-writing accuracy.
training/datasets/ewt-manifest.json|docs|data|record the pinned EWT source and split manifest|Retain corpus revision, integrity, and split information without committing downloaded raw training data.
training/datasets/dictionary-manifest.json|docs|data|record dictionary selection provenance and integrity|Describe the selected lexical source and its reproducible ingestion metadata.
models/releases/manifest.json|build|models|declare frozen model archive and resource checksums|Record the release archive digest and individual asset hashes consumed by clean-checkout restoration.
models/releases/ewt-1.tar.gz|feat|models|ship the frozen local inference resource bundle|Include the validated production models, lexical resources, browser runtime, metadata, and required notices for offline-capable restoration.
models/manifests/registry.json|feat|models|register production syntax and classifier resources|Identify the active model manifests and policy that keeps natural-essay neural findings review-only pending independent evidence.
models/manifests/model.schema.json|feat|models|define the model metadata validation schema|Specify the integrity, provenance, capability, and metric fields expected from model manifests.
models/licenses/onnxruntime-MIT.txt|docs|licenses|retain the ONNX Runtime MIT license notice|Preserve attribution for the browser inference runtime distributed with the frozen model release.
content/regression.json|test|grammar|record controlled grammatical regression examples|Provide labeled developmental cases for checking supported diagnostic categories and clean-sentence behavior.
docs/engineering-specification.md|docs|specification|preserve the complete originating product specification|Keep the user's engineering and product requirements available as the implementation and verification reference.
docs/release-status.md|docs|release|distinguish implemented features from external evidence gates|Record shipped capabilities, current production-path scores and remaining +5-point gaps, detector-validation status, and the learner-corpus, educator, study, and physical-device evidence that remains unestablished.
docs/quickstart.md|docs|setup|document contained cross-platform Make workflows|Explain explicit dependency setup, local development, production builds, and frozen model restoration.
docs/project-containment.md|docs|setup|document project-local runtime and cache boundaries|Describe where tools, dependencies, datasets, models, and temporary state reside and how global installation is avoided.
docs/model-card.md|docs|models|document model provenance metrics and limitations|Publish the actual training data, current all-gold browser and component results, updated token coverage, calibration scope, candidate-training findings, model packaging, and explicit within-corpus and learner-validation limits.
docs/research-data-models.md|docs|research|record data and model source research|Capture source selection, licensing considerations, and the evidence supporting the local inference approach.
docs/design-audit.md|docs|design|record interface decisions and visual verification|Describe the professional workspace treatment, responsive behavior, and observed interface checks.
docs/evaluation-protocol.md|docs|evaluation|define independent accuracy and learning evaluation|Specify the evidence needed for error detection, correction acceptability, comparison, and longitudinal learning claims.
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
packages/engine/src/inflections.ts|feat|spelling|handle productive English inflection patterns|Implement data-driven spelling and mutation support for regular inflections and irregular forms with explicit boundary behavior.
scripts/check-classifier-features.mjs|test|models|verify browser classifier feature parity|Compare the TypeScript runtime feature vectors with the training implementation on recorded fixtures to prevent silent inference drift.
scripts/evaluate-generalization.mjs|test|evaluation|measure production syntax and diagnostic generalization|Run the fixed corpus and authored challenge evaluation, retain each positive case's parse alternatives and explicit limitations, and report scoped metrics without treating development evidence as learner-population accuracy.
scripts/render-social-preview.mjs|build|brand|render cross-browser icon and repository image assets|Generate PNG, ICO, install-icon, and repository preview files from the editable SVG sources using only the project-local browser tooling.
training/ewt_splits.py|feat|training|preserve official EWT document-level split provenance|Assign reproducible source splits before training and exclude exact duplicates without implying independent author or prompt separation.
training/predicted_syntax.py|feat|training|generate contextual syntax candidates for error training|Use trained predictions to construct bounded non-hardcoded mutation candidates and preserve source metadata for evaluation.
training/test_error_mutations.py|test|training|verify contextual grammar mutation generation|Check that generated candidates preserve source offsets and grammatical contrasts across varied sentence contexts.
training/test_ewt_splits.py|test|training|verify reproducible corpus split boundaries|Exercise deterministic grouping, deduplication, and held-out partition invariants used by the training pipeline.
apps/web/src/WritingGoalMap.tsx|feat|goals|browse general developmental writing competencies|Render the lazy-loaded stage-filterable goal catalog with learner examples, register-aware controls, honest detector status, correction policy, and existing practice links without course-specific modes.
apps/web/src/writing-goals.css|style|goals|present the writing progression in the existing interface|Style the expandable competency map with the app’s restrained type, borders, responsive layout, and accessible controls.
packages/engine/src/goals.ts|feat|goals|catalog stable general writing goals and detector limits|Define the developmental progression, examples, controls, proficiency and intent mappings, practice links, and correction policies; label unsupported or unvalidated patterns without implying completeness.
packages/engine/src/goal-metadata.ts|feat|goals|link emitted grammar rules to stable writing goals|Map actual diagnostic rule identifiers to learner-facing goals and produce intent-aware report coverage for the detector set.
packages/engine/tests/advanced-coverage.test.ts|test|grammar|cover parsed boundaries and series punctuation controls|Exercise parsed comma splices across subject forms, run-ons, fragments, missing series commas, valid coordinator and subordinate controls, source offsets, punctuation alternatives, and ambiguity without presenting synthetic fixtures as independent accuracy evidence.
packages/engine/tests/goals.test.ts|test|goals|verify catalog completeness and honest detector status|Check stable identifiers, required goal fields, progression, available practice, unsupported-goal labels, and correction suppression policy.
packages/engine/tests/writing-intent.test.ts|test|goals|verify backward compatibility and rule traceability|Test legacy documents, persisted intent semantics, report metadata, run-on links, and mappings for each emitted diagnostic rule identifier.
tests/browser/writing-intent.spec.ts|test|browser|verify writing intent materials and production grammar paths|Exercise intent persistence through reload, the general writing map, saved material structure on first visit, and real browser analysis that detects pronoun and noun-subject comma splices, applies the semicolon edit, and accepts coordinated and subordinate-clause controls.
docs/writing-progression.md|docs|curriculum|map developmental goals to transferable writing skills|Document how Head Start, Common Core, and advanced public competency sources inform a general progression without AP product logic, speech assessment, or learner-readiness claims.
docs/release-gates-2026-10-24.md|docs|release|report current benchmark scores and unmet release thresholds|Compare current full-EWT and production-browser values with the requested five-point floor, explain browser-sample development exposure, list pattern coverage and quality-evidence gaps, and separate passing product gates from unpassed accuracy targets.
packages/engine/src/document-feedback.ts|feat|feedback|report document-level writing convention observations|Detect sentence-opening capitalization, missing terminal marks, and optional repeated inter-word spacing from parsed sentence context while respecting list markers, quotations, lower-case style, inline code, and source spans.
packages/engine/tests/tokenizer-conventions.test.ts|test|tokenizer|verify Unicode token spans and common writing conventions|Cover URL and email boundaries, decimals, dates, times, identifiers, abbreviations, punctuation runs, contractions, model-vocabulary hyphen compounds, Unicode offsets, and exact span preservation.
packages/engine/tests/writing-conventions.test.ts|test|feedback|verify document conventions and conservative controls|Exercise sentence capitalization, terminal punctuation, repeated spacing, lower-case style, headings, list markers, quotations, code spans, evidence ranges, and correction safety on parsed document text.
training/evaluate_parser_beam.py|test|training|compare parser beam widths on official development data|Measure UAS and LAS for predetermined beam widths on the verified EWT development split, select the narrowest highest-LAS option, and write a local development-only report without evaluating or tuning against held-out test data.
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
        return @('chore', 'models', 'retain the generated model output directory', 'Keep the output location discoverable while excluding generated model candidates and training checkpoints from version control.')
    }
    throw "No file-specific commit description for $Path. Add one before committing."
}

function Get-ContentOutline {
    param([string]$Path)
    $extension = [IO.Path]::GetExtension($Path).ToLowerInvariant()
    if ($extension -in @('.png', '.ico', '.gz', '.pdf', '.docx', '.woff2')) {
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
