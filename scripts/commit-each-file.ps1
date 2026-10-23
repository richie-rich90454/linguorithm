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
Makefile|build|make|provide cross-platform project and release targets|Expose explicit development, installation, training, evaluation, and release commands through GNU Make.
package.json|build|workspace|declare root development tools and task scripts|Pin the workspace package manager and declare the tools required for builds, browser checks, linting, and evaluation.
pnpm-lock.yaml|build|dependencies|lock workspace dependency resolution|Record resolved dependency versions and integrity metadata for reproducible project-local installations.
pnpm-workspace.yaml|build|workspace|define package boundaries and installation policy|Connect the web application and engine packages without automatically reinstalling dependencies during tasks.
tsconfig.json|build|typescript|establish shared TypeScript compiler settings|Provide the common type-checking contract inherited by workspace packages.
playwright.config.ts|test|browser|configure cross-browser application verification|Define browser projects, test execution settings, and the application server contract used by end-to-end checks.
README.md|docs|readme|introduce Syntax with evidence and reproducible setup|Present the product, interface screenshots, local-first workflow, measured capabilities, and contribution entry points without unsupported quality claims.
LICENSE|docs|license|license project source under MIT|Record the user-selected MIT license while leaving third-party model, corpus, dictionary, and font notices separate.
CHANGELOG.md|docs|community|document the initial platform release|Describe the delivered capabilities and release scope for readers evaluating the project history.
CODE_OF_CONDUCT.md|docs|community|establish contributor conduct expectations|Define respectful participation and reporting guidance for the project community.
CONTRIBUTING.md|docs|community|explain contribution and verification workflows|Describe local setup, contribution boundaries, and checks expected before proposing changes.
SECURITY.md|docs|security|document vulnerability reporting and trust boundaries|Explain security reporting expectations and the application's handling of local documents and imported content.
SUPPORT.md|docs|community|explain support requests and diagnostic context|Help users distinguish support questions from defects and provide useful reproducible information.
apps/web/src/App.tsx|feat|web|integrate navigation documents settings and local restore|Connect the application views, document lifecycle, persisted preferences, assessments, and bounded backup restoration.
apps/web/src/EssayLab.tsx|feat|editor|provide revision-aware essay analysis and corrections|Render the writing workspace, source-linked findings, correction review, and analysis controls around the current document revision.
apps/web/src/Workbench.tsx|feat|syntax|render inspectable sentence relationships|Expose token-level syntax, labeled dependency arcs, parse alternatives, and sentence inspection controls.
apps/web/src/Practice.tsx|feat|learning|deliver adaptive practice and assessment sessions|Present skill practice, answer feedback, source-linked exercises, and assessment flows while withholding answers before submission.
apps/web/src/Progress.tsx|feat|progress|present learning history and portable progress|Show recorded skill evidence and learning activity with export and restoration controls.
apps/web/src/styles.css|style|web|establish the professional editorial interface|Define Noto Sans typography, restrained functional colors, responsive workspaces, accessible controls, and bounded desktop reading panes.
apps/web/src/icons.tsx|feat|web|provide a consistent interface icon vocabulary|Supply reusable vector icons for navigation and application actions within the established visual language.
apps/web/src/main.tsx|feat|web|mount the Solid application and offline integration|Connect the application entry point, global styles, and production browser lifecycle.
apps/web/src/env.d.ts|build|web|declare browser build environment types|Provide compile-time declarations needed by the Vite application and asset imports.
apps/web/src/analysis.worker.ts|feat|analysis|isolate grammar analysis in a browser worker|Move analysis work off the interface thread and exchange typed requests and results with the application.
apps/web/src/local-syntax.ts|feat|models|load and verify local neural syntax resources|Validate model hashes and compatibility, run local inference, and support bounded verified caching with retry after failed downloads.
apps/web/src/persistence.ts|feat|storage|persist documents learning evidence and bounded backups|Manage Dexie schema evolution, chronological merges, capacity limits, and transactional local state restoration.
apps/web/src/import.ts|feat|import|extract local learning materials from supported documents|Normalize supported text and document formats while preserving bounded import behavior and safe source references.
apps/web/src/office-import.ts|feat|import|read ordered presentation and spreadsheet content|Extract slide and sheet text from OOXML without executing formulas, macros, external links, or active document content.
apps/web/src/archive-safety.ts|feat|security|bound and validate document archive expansion|Enforce ZIP entry, decompression, integrity, and path constraints before imported office content reaches application parsing.
apps/web/vite.config.ts|build|web|configure static production and offline asset delivery|Configure the Solid build and service worker resource policies for application files and verified model loading.
apps/web/index.html|feat|web|define the application document shell|Provide the static browser entry document and metadata for the local-first writing workspace.
apps/web/public/_headers|build|security|declare static hosting response protections|Record response headers expected when serving the production application through compatible static hosts.
apps/web/public/icon.svg|style|brand|provide the application vector identity|Supply a scalable project icon for browser and installed application surfaces.
apps/web/public/Noto-Sans-OFL.txt|docs|licenses|retain the Noto Sans open font license|Ship the full font notice alongside the application resources that use the typeface.
apps/web/public/licenses/noto-sans.txt|docs|licenses|retain bundled typeface attribution|Make the font licensing terms available within the distributed application license resources.
packages/engine/src/domain.ts|feat|engine|define shared grammar and learning domain contracts|Establish typed structures exchanged by analysis, document editing, corrections, and learning components.
packages/engine/src/text.ts|feat|documents|preserve source offsets and monotonic document revisions|Implement text segmentation and document edits with UTF-16 source identity, undo and redo, and timestamps that advance beyond restored revisions.
packages/engine/src/grammar.ts|feat|grammar|detect bounded grammatical patterns and propose repairs|Provide deterministic grammar diagnostics with explicit evidence and correction edits suitable for source rechecking.
packages/engine/src/advanced-grammar.ts|feat|grammar|analyze contextual clause and construction patterns|Extend conservative analysis across agreement, auxiliaries, comparisons, modifiers, references, and related sentence structures.
packages/engine/src/spelling.ts|feat|spelling|retrieve bounded dictionary correction candidates|Implement spelling candidate search and edit-distance behavior for local lexical diagnostics.
packages/engine/src/pipeline.ts|feat|analysis|coordinate deterministic analysis and diagnostic resolution|Combine analysis stages, source-linked findings, overlap handling, and correction behavior behind a shared engine interface.
packages/engine/src/hybrid.ts|feat|analysis|combine neural syntax with conservative rule evidence|Integrate model-derived structures and review-only neural findings without suppressing independent overlapping diagnostics.
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
packages/engine/src/index.ts|feat|engine|expose the public analysis and learning API|Collect supported engine entry points for the web application, training utilities, and verification tools.
scripts/task.mjs|build|make|dispatch tasks with project-contained runtime state|Run explicit tool entry points with argument arrays, local caches, and platform-aware runtime selection behind Make targets.
scripts/project-env.ps1|build|training|prepare a project-local Windows training environment|Expose the contained runtimes and cache locations needed for manual training commands without global installation.
scripts/restore-models.mjs|build|models|restore verified resources from the frozen release archive|Validate archive structure, containment, hashes, and resource limits before restoring missing or modified production model files.
scripts/package-model-release.mjs|build|models|package deterministic production model resources|Create the bounded frozen release archive and per-file integrity manifest from validated production assets.
scripts/check-model-release.mjs|test|models|verify clean restoration repair and corruption rejection|Exercise release restoration in an isolated project-local tree, including modified assets and a corrupted archive.
scripts/validate-models.mjs|test|models|validate model manifests resources and provenance|Check packaged resources against their declared integrity metadata and release requirements.
scripts/check-bundle.mjs|test|build|enforce the initial JavaScript transfer budget|Measure the production entry bundle and reject releases exceeding the declared compressed size threshold.
scripts/validate-content.ts|test|content|validate authored and generated practice questions|Check answer uniqueness, mutation restoration, and skill coverage before content is included in a release.
scripts/evaluate.ts|test|evaluation|evaluate grammar regression cases with uncertainty|Compute development metrics and category intervals from the checked-in regression corpus without claiming population accuracy.
scripts/compare-systems.mts|test|evaluation|support reproducible system comparison inputs|Provide comparison tooling for independently supplied system results and the documented evaluation protocol.
scripts/ablate-browser.mts|test|evaluation|compare browser analysis component ablations|Measure rules-only and hybrid variants while recording source integrity and false positives on controlled cases.
scripts/benchmark.ts|perf|engine|measure local engine analysis performance|Record reproducible engine timing evidence for the documented development workload.
scripts/benchmark-browser.mjs|perf|browser|measure cold and cached browser analysis latency|Exercise actual browser inference and report workload-specific timings without substituting emulation for physical-device evidence.
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
training/README.md|docs|training|document reproducible model development and packaging|Explain the data, training, evaluation, and export workflow along with its measured limitations.
training/datasets/ewt-manifest.json|docs|data|record the pinned EWT source and split manifest|Retain corpus revision, integrity, and split information without committing downloaded raw training data.
training/datasets/dictionary-manifest.json|docs|data|record dictionary selection provenance and integrity|Describe the selected lexical source and its reproducible ingestion metadata.
models/releases/manifest.json|build|models|declare frozen model archive and resource checksums|Record the release archive digest and individual asset hashes consumed by clean-checkout restoration.
models/releases/ewt-1.tar.gz|feat|models|ship the frozen local inference resource bundle|Include the validated production models, lexical resources, browser runtime, metadata, and required notices for offline-capable restoration.
models/manifests/registry.json|feat|models|register production syntax and classifier resources|Identify the active model manifests and policy that keeps natural-essay neural findings review-only pending independent evidence.
models/manifests/model.schema.json|feat|models|define the model metadata validation schema|Specify the integrity, provenance, capability, and metric fields expected from model manifests.
models/licenses/onnxruntime-MIT.txt|docs|licenses|retain the ONNX Runtime MIT license notice|Preserve attribution for the browser inference runtime distributed with the frozen model release.
content/regression.json|test|grammar|record controlled grammatical regression examples|Provide labeled developmental cases for checking supported diagnostic categories and clean-sentence behavior.
docs/engineering-specification.md|docs|specification|preserve the complete originating product specification|Keep the user's engineering and product requirements available as the implementation and verification reference.
docs/release-status.md|docs|release|distinguish implemented features from external evidence gates|Record shipped capabilities and the learner-corpus, educator, study, and physical-device evidence that remains unestablished.
docs/quickstart.md|docs|setup|document contained cross-platform Make workflows|Explain explicit dependency setup, local development, production builds, and frozen model restoration.
docs/project-containment.md|docs|setup|document project-local runtime and cache boundaries|Describe where tools, dependencies, datasets, models, and temporary state reside and how global installation is avoided.
docs/model-card.md|docs|models|document model provenance metrics and limitations|Publish the actual training data, held-out results, calibration scope, model packaging, and deployment policy.
docs/research-data-models.md|docs|research|record data and model source research|Capture source selection, licensing considerations, and the evidence supporting the local inference approach.
docs/design-audit.md|docs|design|record interface decisions and visual verification|Describe the professional workspace treatment, responsive behavior, and observed interface checks.
docs/evaluation-protocol.md|docs|evaluation|define independent accuracy and learning evaluation|Specify the evidence needed for error detection, correction acceptability, comparison, and longitudinal learning claims.
docs/images/workspace.png|docs|readme|illustrate the actual essay workspace|Provide the screenshot used to show the delivered editor and source-linked diagnostic interface.
docs/images/workbench.png|docs|readme|illustrate the actual sentence workbench|Provide the screenshot used to show token inspection and labeled dependency relationships.
.github/workflows/ci.yml|ci|verification|run the contained Make verification pipeline|Define hosted checks for setup, engine validation, content, production assets, and browser behavior without claiming a hosted run has occurred.
.github/workflows/models.yml|ci|models|define explicit candidate model training and validation|Keep model candidate generation and evaluation separate from restoration of the frozen production bundle.
.github/PULL_REQUEST_TEMPLATE.md|docs|community|guide reviewable change descriptions|Ask contributors for the concrete change, validation evidence, and relevant limitations when opening a pull request.
.github/ISSUE_TEMPLATE/bug_report.yml|docs|community|collect reproducible defect reports|Structure bug reports around observed behavior, reproduction steps, and useful environment details.
.github/ISSUE_TEMPLATE/feature_request.yml|docs|community|collect actionable feature proposals|Structure proposals around the user problem, expected behavior, and project fit.
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
    if ($extension -in @('.png', '.gz', '.pdf', '.docx', '.woff2')) {
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
    if ($exists -and [IO.Path]::GetExtension($path) -notin @('.png', '.gz', '.pdf', '.docx', '.woff2')) {
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
