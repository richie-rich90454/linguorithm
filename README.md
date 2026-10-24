# Linguorithm

**An English grammar checker, sentence analyzer, and practice workspace that runs locally in your browser.**

Linguorithm combines an essay editor, sentence workbench, adaptive practice, and learning records in a SolidJS/TypeScript application. Compact trained models run in a browser worker. Writing stays in the browser: no accounts, essay uploads, analytics, remote fonts, or generative services.

[Quick start](#start-locally) · [Features](#what-you-can-do) · [Model card](docs/model-card.md) · [Contributing](CONTRIBUTING.md) · [Support](SUPPORT.md)

![Linguorithm essay workspace with source-linked findings and a subject–verb agreement explanation](docs/images/workspace.png)

## Why Linguorithm

A correction is more useful when you can inspect its reasoning. Linguorithm connects a finding to the original words, the grammatical relationship behind it, and a focused practice exercise. You control each edit, can undo it exactly, and keep your writing on your device.

For writers, tutors, and developers who want an inspectable local grammar tool, it combines compact discriminative models with explicit constraints. It proposes bounded edits rather than generating replacement paragraphs.

| Your goal                                        | Start here                                |
| ------------------------------------------------ | ----------------------------------------- |
| Try the editor and practice exercises            | [Run Linguorithm locally](#start-locally) |
| Understand accuracy, privacy, or model limits    | [Model card](docs/model-card.md)          |
| Reproduce a bug or question a grammar finding    | [Support and reporting](SUPPORT.md)       |
| Improve grammar examples, documentation, or code | [Contribution guide](CONTRIBUTING.md)     |

## Start locally

With GNU Make and Node.js 24 LTS available, clone the repository and run from its root:

```sh
make install-pnpm
make install
make dev
```

Dependency setup is explicit and project-local. If this working copy is already prepared, start directly with `make dev`. Open the address printed by Vite. For a production build:

```sh
make check
make build
make preview
```

The preview runs at [127.0.0.1:4317](http://127.0.0.1:4317). A fresh clone needs Node and explicit dependency setup; see the [quickstart](docs/quickstart.md) for Windows, macOS, and Linux. The build restores bundled, hash-verified models from the tracked release archive. Frontend builds need neither Python nor training-data downloads.

## What you can do

- **Revise an essay.** Follow diagnostics back to source spans, compare revisions, undo changes, review contextual spelling candidates, and maintain a personal dictionary.
- **Explore a sentence.** Inspect predicted parts of speech and dependency diagrams, including alternative analyses and visible model/fallback status.
- **Practice deliberately.** Work through seven skills with progressive hints, free-response repairs, and a validated bank of 106 questions.
- **Learn from your materials.** Import TXT, Markdown, inert HTML, DOCX, PPTX, XLSX, and text-based PDF while retaining source structure and question provenance.
- **Track your work.** Review pre/post/delayed/transfer assessment records, export CSV, and back up or restore local data.

Assessment records support reflection; they do not establish a measured learning benefit.

## How analysis works

The `ewt-1` release includes a character-CNN/BiLSTM/CRF tagger, beam dependency parser, synthetic-error classifier, and trained contextual correction ranker. The SCOWL-derived dictionary recognizes 121,191 forms. Resource hashes are checked before inference, and failures visibly activate deterministic fallback analysis.

Full held-out UD English EWT component evaluation measures **94.47% POS accuracy**, **81.66% UAS**, and **77.27% LAS** on 1,962 test sentences. A separate production-browser benchmark on 300 held-out EWT sentences across answers, email, newsgroup, reviews, and weblog measures **92.18% POS**, **80.16% UAS**, and **76.09% LAS**, counting tokenization mismatches as incorrect. This is within-corpus evidence, not independent learner-essay validation.

No error-classifier category currently passes the release emission gate. On 63 controlled agreement mutations, the complete hybrid detects 47 and misses 16, with zero target-token false positives on 63 source controls; the classifier alone emits none. On 26 authored clean probes, there are zero conservative false positives and one review warning. These small synthetic/development checks do not establish natural-error precision or recall. Neural findings remain review-only, and a clean report cannot certify correctness. See the [measured browser evidence](reports/generalization.json) and [evaluation details](docs/model-card.md#production-browser-generalization-check).

Read the [model card](docs/model-card.md) for provenance, evaluation methods, domain limits, quantization results, and licensing. Initial successful model loading enables offline reuse through the service worker; browser storage eviction can require loading assets again.

## Developer commands

| Command | Purpose |
| --- | --- |
| `make dev` | Start the development server |
| `make check` | Lint, formatting check, TypeScript, and engine tests |
| `make release` | Source, content, clean model restore, build, bundle, and browser release checks |
| `make build` / `make preview` | Restore models, build, and serve production output |
| `make test` | Run engine unit tests |
| `make browser` | Run Playwright tests against the production build |
| `make evaluate` | Evaluate deterministic engine behavior |
| `make models` / `make validate-models` | Restore or verify packaged model resources |
| `make content` | Validate questions and formatter configuration consistency |
| `make bundle` | Check built bundle budgets |
| `make benchmark` | Run the engine benchmark |
| `make inspect` | Inspect the running production preview |
| `make social-preview` | Render the editable social preview to its GitHub-ready PNG |
| `make train` | Retrain, evaluate, and package local models using `.venv` |

Use `make help` for setup and additional evaluation targets. Pass options with `ARGS`, for example `make browser ARGS="--project=chromium"`. Browser tests require `make build` first. Inspection and browser benchmarks require `make preview` in a separate terminal. Normal tasks never install missing prerequisites automatically.

## Project map

| Path              | Contents                                                          |
| ----------------- | ----------------------------------------------------------------- |
| `apps/web`        | SolidJS application, worker, local persistence, production assets |
| `packages/engine` | Analysis, practice, assessment, import domain logic               |
| `content`         | Validated practice content                                        |
| `models/releases` | Versioned browser-model release and integrity manifest            |
| `training`        | Reproducible training, calibration, and packaging pipeline        |
| `tests/browser`   | Browser workflows, inference parity, failure cases                |
| `reports`         | Recorded evaluation and verification evidence                     |
| `docs`            | Model card, specification, release status, research               |

Production output is `apps/web/dist`. It uses relative asset paths for project subpaths and includes a GitHub Pages deployment workflow. Connect the repository to GitHub, set **Settings → Pages → Build and deployment → Source** to **GitHub Actions**, and push to `main`; the site deploys only after the `Verify platform` workflow succeeds. A maintainer can also start the deployment workflow manually. Keep the workflow's Pages permissions enabled and preserve all packaged resource notices. No public URL is claimed until the deployment completes successfully.

## Contributing and support

Start with [contributing](CONTRIBUTING.md), the [support guide](SUPPORT.md), and our [code of conduct](CODE_OF_CONDUCT.md). Report vulnerabilities using the [security policy](SECURITY.md). Bug, grammar feedback, and feature templates are available through this repository's Issues page.

If Linguorithm is useful to you, star the repository so others can find it. Share a reproducible workflow or a short synthetic grammar example to help other writers and educators assess whether it fits their needs. Good bug reports, carefully reviewed grammar examples, and small, tested contributions help the project improve.

Maintainers can use the [GitHub presentation guide](docs/github-discovery.md) for the prepared social preview, suggested topics, and repository settings.

See the [engineering specification](docs/engineering-specification.md), [training guide](training/README.md), [release status](docs/release-status.md), and [recorded verification](reports/verification.md) for technical context. Independent natural-learner validation, educator review, comparative trials, physical-device performance, and a consented learning study remain external release requirements.

## License and attribution

Application source is available under the [MIT License](LICENSE). Bundled models, corpora, dictionaries, and runtime dependencies retain their own licenses. UD English EWT is CC-BY-SA 4.0; the dictionary includes multiple upstream notices. Consult the [model card](docs/model-card.md), provenance manifests, and `apps/web/public/models/licenses/` before redistributing resources. Preserve those notices and applicable attribution/share-alike obligations. The source MIT license does not replace resource licenses.
